// Called only by the existing owner-private, bound schedule queue.
const DDOL_TEAM_PROJECT = 'mycalendar-e2862';
const DDOL_TEAM_CENTER = 'gw-rehab-center';
const DDOL_TEAM_DOCS = 'https://firestore.googleapis.com/v1/projects/'+DDOL_TEAM_PROJECT+'/databases/(default)/documents';
function teamJson_(response) {
  let value=null;
  try {value=JSON.parse(response.getContentText());} catch (_) {}
  return {code:response.getResponseCode(),value};
}
function teamFetch_(url,options) {
  return teamJson_(UrlFetchApp.fetch(url,{...options,followRedirects:false,muteHttpExceptions:true}));
}
function teamRefresh_(settings,props) {
  const key=settings.TEAM_FIREBASE_API_KEY, uid=settings.TEAM_FIREBASE_UID, refresh=settings.TEAM_FIREBASE_REFRESH;
  if(!/^AIza[\w-]{27,55}$/.test(key||'')||!/^dot-team-calendar-writer-[a-f0-9]{24,40}$/.test(uid||'')||!refresh) return null;
  const auth=teamFetch_('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(key),{
    method:'post',contentType:'application/x-www-form-urlencoded',
    payload:'grant_type=refresh_token&refresh_token='+encodeURIComponent(refresh)
  });
  if(auth.code!==200||auth.value?.user_id!==uid||typeof auth.value?.id_token!=='string') return null;
  let p;
  try {
    p=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(auth.value.id_token.split('.')[1])).getDataAsString('UTF-8'));
  } catch (_) {return null;}
  if(p.aud!==DDOL_TEAM_PROJECT||p.sub!==uid||p.firebase?.sign_in_provider!=='custom'||p.ddol_calendar_writer!==true) return null;
  if(typeof auth.value.refresh_token==='string'&&auth.value.refresh_token&&auth.value.refresh_token!==refresh) {
    props.setProperty('TEAM_FIREBASE_REFRESH',auth.value.refresh_token);
    settings.TEAM_FIREBASE_REFRESH=auth.value.refresh_token;
  }
  return auth.value.id_token;
}
function teamCalendarDelivery_(r,settings) {
  if(settings.TEAM_FIREBASE_ENABLED!=='true') return {status:'configuration_required'};
  try {
    const props=PropertiesService.getScriptProperties(), idToken=teamRefresh_(settings,props);
    if(!idToken)return {status:'error',code:'writer_unavailable'};
    const id='dot_'+Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,DDOL_TEAM_CENTER+':google:'+r.key,Utilities.Charset.UTF_8)
      .map(n=>(n&255).toString(16).padStart(2,'0')).join('');
    const event={centerId:DDOL_TEAM_CENTER,dateKey:r.date,startDateKey:r.date,endDateKey:r.end,startTime:r.start,endTime:r.finish,
      title:r.title,body:r.note,location:r.location,group:r.group,eventType:r.kind,status:'planned',priority:'normal',source:'dot'};
    const textFields=Object.fromEntries(Object.entries(event).map(([name,val])=>[name,{stringValue:val}]));
    const timestamp={timestampValue:new Date().toISOString()};
    const headers={Authorization:'Bearer '+idToken};
    const written=teamFetch_(DDOL_TEAM_DOCS+'/events?documentId='+id,{method:'post',contentType:'application/json',headers,
      payload:JSON.stringify({fields:{...textFields,createdAt:timestamp,updatedAt:timestamp}})});
    if(written.code===200||written.code===201) return {status:'created',id};
    if(written.code===409) {
      const current=teamFetch_(DDOL_TEAM_DOCS+'/events/'+id,{method:'get',headers});
      if(current.code===200&&Object.entries(event).every(([name,val])=>current.value?.fields?.[name]?.stringValue===val)) return {status:'existing',id};
      return {status:'possible_duplicate',id};
    }
    return {status:'error',code:written.code,retryable:written.code>=500||written.code===429};
  } catch (_) {return {status:'error',retryable:true};}
}
function checkTeamCalendarIdentity() {
  const props=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('relay_busy');
  try {if(!teamRefresh_(props.getProperties(),props))throw Error('team_writer_unavailable');}
  finally {lock.releaseLock();}
}
