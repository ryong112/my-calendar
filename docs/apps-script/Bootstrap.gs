// Run only as the Firebase/GCP owner from a private, non-deployed script.
const PROJECT = 'mycalendar-e2862';
const OWNER_EMAIL = 'REPLACE_WITH_FIREBASE_OWNER_EMAIL';
const FIREBASE_WEB_API_KEY = 'REPLACE_WITH_EXISTING_FIREBASE_WEB_API_KEY';
const UID_PROP = 'DOT_FIREBASE_WRITER_UID';
const REFRESH_PROP = 'DOT_FIREBASE_WRITER_REFRESH_TOKEN';
const ROOT = 'https://identitytoolkit.googleapis.com/v1/';
const IAM = 'https://iam.googleapis.com/v1/';
const JWT_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function preflight() {
  const ctx = makeCtx_();
  preflight_(ctx);
  return 'Read-only preflight OK for ' + PROJECT;
}

function provisionOnce() {
  const ctx = makeCtx_();
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (props.getProperty(UID_PROP) || props.getProperty(REFRESH_PROP)) fail_('Credentials already present; no changes made');
    preflight_(ctx);
    run_(ctx, props, Utilities.getUuid().replace(/-/g, '').toLowerCase());
    return 'Bootstrap complete. Dedicated credentials saved to private Script Properties.';
  } finally {
    lock.releaseLock();
  }
}

function makeCtx_() {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OWNER_EMAIL)) fail_('Configure verified owner email');
  if (!/^AIza[A-Za-z0-9_-]{30,}$/.test(FIREBASE_WEB_API_KEY)) fail_('Configure existing Firebase web API key');
  const access = ScriptApp.getOAuthToken();
  return {
    key: FIREBASE_WEB_API_KEY,
    owner: OWNER_EMAIL.toLowerCase(),
    now: () => Date.now(),
    sleep: ms => Utilities.sleep(ms),
    decode: s => Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '='.repeat((4 - s.length % 4) % 4))).getDataAsString('UTF-8'),
    call(label, method, url, data, privileged) {
      let res;
      try {
        const opts = {method, muteHttpExceptions: true, followRedirects: false, headers: {}};
        if (privileged) {
          opts.headers.Authorization = 'Bearer ' + access;
          if (!url.startsWith('https://www.googleapis.com/oauth2/')) opts.headers['x-goog-user-project'] = PROJECT;
        }
        if (data !== undefined) {
          opts.contentType = typeof data === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
          opts.payload = typeof data === 'string' ? data : JSON.stringify(data);
        }
        res = UrlFetchApp.fetch(url, opts);
      } catch (_) { fail_(label + ': transport error (no response body displayed)'); }
      const code = res.getResponseCode();
      let body;
      try { body = JSON.parse(res.getContentText() || '{}'); }
      catch (_) { fail_(label + ': unreadable HTTP ' + code); }
      return {code, body};
    }
  };
}

function fail_(message) { throw new Error(message); }

function need_(ctx, label, method, url, data, privileged = true, accepted = [200]) {
  const r = ctx.call(label, method, url, data, privileged);
  if (!accepted.includes(r.code)) {
    const detail = ((r.body && r.body.error && r.body.error.details) || [])
      .find(d => d && d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo');
    const reason = detail && ['SERVICE_DISABLED','CONSUMER_INVALID','USER_PROJECT_DENIED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','IAM_PERMISSION_DENIED'].includes(detail.reason) ? ' (' + detail.reason + ')' : '';
    fail_(label + ': HTTP ' + r.code + reason);
  }
  return r.body;
}

function preflight_(ctx) {
  const user = need_(ctx, 'Verify current Google account', 'get', 'https://www.googleapis.com/oauth2/v2/userinfo');
  if (user.verified_email !== true || String(user.email).toLowerCase() !== ctx.owner) fail_('Wrong or unverified Google account');
  const project = need_(ctx, 'Verify target Firebase project', 'get', 'https://firebase.googleapis.com/v1beta1/projects/' + PROJECT);
  if (project.projectId !== PROJECT || !/^\d+$/.test(String(project.projectNumber))) fail_('Unexpected target Firebase project');
  const services = ['iamcredentials.googleapis.com', 'iam.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'];
  for (const service of services) {
    const item = need_(ctx, 'Check service ' + service, 'get', 'https://serviceusage.googleapis.com/v1/projects/' + project.projectNumber + '/services/' + service);
    if (item.state !== 'ENABLED') fail_(service + ' not enabled; no services changed');
  }
  const rules = need_(ctx, 'Read active Firestore release', 'get', 'https://firebaserules.googleapis.com/v1/projects/' + PROJECT + '/releases/cloud.firestore');
  if (!new RegExp('^projects/' + PROJECT + '/rulesets/[A-Za-z0-9_-]+$').test(rules.rulesetName || '')) fail_('Unexpected ruleset');
  const source = need_(ctx, 'Read exact active Firestore rules', 'get', 'https://firebaserules.googleapis.com/v1/' + rules.rulesetName);
  if (!source.source || !Array.isArray(source.source.files) || !source.source.files.length) fail_('Empty ruleset');
  return rules.rulesetName;
}

function run_(ctx, props, suffix) {
  if (!/^[a-f0-9]{32}$/.test(suffix)) fail_('Invalid bootstrap ID');
  const sid = 'dot-fb-signer-' + suffix.slice(0, 12);
  const uid = 'dot-team-calendar-writer-' + suffix;
  const email = sid + '@' + PROJECT + '.iam.gserviceaccount.com';
  const sa = IAM + 'projects/' + PROJECT + '/serviceAccounts/' + email;
  const iamRole = 'roles/iam.serviceAccountTokenCreator';
  const member = 'user:' + ctx.owner;
  const claimUrl = ROOT + 'projects/' + PROJECT + '/accounts:update';
  const deleteUrl = ROOT + 'projects/' + PROJECT + '/accounts:delete';
  const title = 'dot-bootstrap-' + suffix.slice(0, 12);
  let createAttempt = false, claimedAccount = false, boundAttempt = false, grantRemoved = false, signerGone = false, committed = false;
  try {
    createAttempt = true;
    const signer = need_(ctx, 'Create dedicated role-less signer', 'post', IAM + 'projects/' + PROJECT + '/serviceAccounts',
      {accountId:sid, serviceAccount:{displayName:'Dot calendar one-time Firebase signer'}}, true, [200,201]);
    if (signer.email !== email || !/^\d+$/.test(signer.uniqueId || '')) fail_('Unexpected signer identity');
    const getPolicy = () => need_(ctx,'Read signer policy','post',sa + ':getIamPolicy',{options:{requestedPolicyVersion:3}});
    const setPolicy = policy => need_(ctx,'Set signer-scoped policy','post',sa + ':setIamPolicy',{policy});
    const bind = {role:iamRole, members:[member], condition:{title,expression:'request.time < timestamp("' + new Date(ctx.now() + 8*60000).toISOString() + '")'}};
    const policy = getPolicy();
    boundAttempt = true;
    setPolicy({...policy, version:3, bindings:[...(policy.bindings || []),bind]});
    const iat = Math.floor(ctx.now()/1000);
    const payload = JSON.stringify({iss:email, sub:email, aud:JWT_AUD, iat, exp:iat+240, uid});
    const signUrl = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + email + ':signJwt';
    let signed;
    for (let i=0;i<9;i++) {
      const p = ctx.call('Sign Firebase custom token','post',signUrl,{payload},true);
      if (p.code === 200) { signed = p.body.signedJwt; break; }
      if (![403,404,429,500,503].includes(p.code)) fail_('Sign Firebase custom token: HTTP ' + p.code);
      ctx.sleep(i<4 ? 3000 : 6000);
    }
    if (!signed) fail_('Signer did not become usable within retry window');
    claimedAccount = true;
    const first = need_(ctx,'Exchange custom token','post',ROOT + 'accounts:signInWithCustomToken?key=' + ctx.key,
      {token:signed, returnSecureToken:true},false);
    check_(ctx, first.idToken, uid, false);
    if (!first.refreshToken) fail_('Missing dedicated refresh token');
    need_(ctx,'Set dedicated writer claim','post',claimUrl,
      {localId:uid,customAttributes:JSON.stringify({ddol_calendar_writer:true})});
    const changed = getPolicy();
    setPolicy({...changed,version:3,bindings:(changed.bindings || []).filter(b => !(b.role===iamRole && b.condition && b.condition.title===title))});
    if ((getPolicy().bindings || []).some(b => b.condition && b.condition.title===title)) fail_('Temporary grant still present');
    grantRemoved = true;
    need_(ctx,'Delete one-time signer','delete',sa,undefined,true,[200,204,404]);
    signerGone = true;
    let refresh = first.refreshToken;
    for (let i=0;i<2;i++) {
      const step = need_(ctx,'Refresh dedicated writer session','post','https://securetoken.googleapis.com/v1/token?key=' + ctx.key,
        'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh),false);
      if (step.user_id !== uid || !step.refresh_token) fail_('Refresh returned unexpected identity');
      refresh = step.refresh_token;
      check_(ctx,step.id_token,uid,true);
    }
    props.setProperties({[UID_PROP]:uid,[REFRESH_PROP]:refresh},false);
    committed = true;
  } finally {
    const pending = [];
    if (!committed && claimedAccount) {
      try {
        const result = ctx.call('Clean up dedicated Firebase account','post',deleteUrl,{localId:uid},true);
        const missing = result.code === 400 && result.body.error && result.body.error.message === 'USER_NOT_FOUND';
        if (result.code !== 200 && result.code !== 404 && !missing) fail_('Cleanup rejected');
      } catch (_) { pending.push('Firebase UID ' + uid); }
    }
    if (createAttempt && !signerGone) {
      try { need_(ctx,'Clean up dedicated signer','delete',sa,undefined,true,[200,204,404]); }
      catch (_) { pending.push('signer ' + email + (boundAttempt && !grantRemoved ? ' (time-limited grant)' : '')); }
    }
    if (pending.length) fail_('Bootstrap stopped; cleanup may be required for ' + pending.join(', '));
  }
}

function check_(ctx, token, uid, claim) {
  let row;
  try { row = JSON.parse(ctx.decode(token.split('.')[1])); }
  catch (_) { fail_('Unreadable Firebase ID token'); }
  if (row.aud !== PROJECT || row.iss !== 'https://securetoken.google.com/' + PROJECT || row.sub !== uid ||
      !row.firebase || row.firebase.sign_in_provider !== 'custom' || (claim && row.ddol_calendar_writer !== true)) {
    fail_('Firebase ID token does not match required project, identity, provider or claim');
  }
}
