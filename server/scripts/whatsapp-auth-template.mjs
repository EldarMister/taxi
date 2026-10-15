import 'dotenv/config';

// Run from server/ with credentials in its private .env or environment.
// Never place an access token on the command line or print provider bodies.
const token=process.env.WHATSAPP_CLOUD_TOKEN?.trim();
const waba=process.env.WHATSAPP_CLOUD_WABA_ID?.trim();
const version=process.env.WHATSAPP_CLOUD_VERSION?.trim()||'v25.0';
const name=process.env.WHATSAPP_CLOUD_TEMPLATE?.trim()||'atlas';
const language=process.env.WHATSAPP_CLOUD_LANGUAGE?.trim()||'ru';
if (!token || !/^\d{6,30}$/.test(waba||'') || !/^v\d{2}\.0$/.test(version)
  || !/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
  console.error('Configure WHATSAPP_CLOUD_TOKEN, WABA_ID, TEMPLATE, LANGUAGE and VERSION in the server environment.');
  process.exit(1);
}
const url=`https://graph.facebook.com/${version}/${waba}/message_templates`;
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function request(url,options={}) {
  const response=await fetch(url,{...options,headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if (!response.ok || result.error) {
    // Numeric diagnostics only: upstream error text can echo request secrets.
    throw new Error(`Meta refused: HTTP ${response.status}, code ${Number(result.error?.code)||0}, subcode ${Number(result.error?.error_subcode)||0}`);
  }
  return result;
}
try {
  // Idempotent on repeat runs, including after ambiguous POST timeouts.
  const existing=await request(`${url}?name=${encodeURIComponent(name)}&fields=id,name,language,status,category,components&limit=100`);
  const found=existing.data?.find(item=>item.name===name&&item.language===language);
  if(found) {
    if(found.category!=='AUTHENTICATION')throw new Error('Existing template has another category; do not overwrite it.');
    console.log(JSON.stringify({id:found.id,name:found.name,language:found.language,status:found.status,existing:true}));
  }else{
    const payload={name,language,category:'AUTHENTICATION',message_send_ttl_seconds:300,components:[
      {type:'BODY',add_security_recommendation:true},{type:'FOOTER',code_expiration_minutes:5},
      {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'ZERO_TAP',zero_tap_terms_accepted:true,supported_apps:[
        {package_name:'atlas.kg',signature_hash:'AhDnRV8wj+C'},
        {package_name:'atlas.pro',signature_hash:'zpsXs/K48RO'},
      ]}]},
    ]};
    const result=await request(url,{method:'POST',body:JSON.stringify(payload)});
    console.log(JSON.stringify({id:result.id,status:result.status,category:result.category,name,language}));
  }
}catch(error){
  console.error(error.message?.startsWith('Meta refused:')||error.message?.startsWith('Existing template')?error.message:'Template request failed. Check the existing template before retrying.');
  process.exitCode=1;
}
