const fs = require("fs");
const API = "http://127.0.0.1:3000/api";
async function req(path, {method="GET", token, body, form, raw}={}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer "+token;
  let payload;
  if (form) { payload = form; }
  else if (body!==undefined) { headers["Content-Type"]="application/json"; payload=JSON.stringify(body); }
  const res = await fetch(API+path,{method,headers,body:payload});
  const text = await res.text();
  let json=null; try{json=JSON.parse(text)}catch{}
  if (raw) return {res,json,text};
  if (!res.ok) throw new Error(method+" "+path+" -> "+res.status+" "+(json?.message?JSON.stringify(json.message):text.slice(0,200)));
  return json?.data ?? json;
}
(async()=>{
  const deviceId = "web-trim-"+Date.now();
  const reg = await req("/auth/register",{method:"POST",body:{username:"trim_"+Date.now(),password:"password123",deviceId}});
  const token = reg.accessToken;
  const buf = fs.readFileSync(process.env.LONG_MP4);
  const ticket = await req("/media/upload-ticket",{method:"POST",token,body:{fileName:"long.mp4",mimeType:"video/mp4",mediaType:"video",sizeBytes:buf.length,purpose:"reel",encryptedFileKey:"public-unencrypted"}});
  const form = new FormData();
  form.append("file", new Blob([buf],{type:"video/mp4"}),"long.mp4");
  const url = ticket.upload.url.startsWith("http")?ticket.upload.url:"http://127.0.0.1:3000"+ticket.upload.url;
  const up = await fetch(url,{method:"POST",body:form});
  if (!up.ok) throw new Error("upload "+up.status);
  await req("/media/complete",{method:"POST",token,body:{mediaId:ticket.media.id,durationSeconds:65}});
  const status = await req("/media/trim/status");
  console.log("TRIM_STATUS", JSON.stringify(status));
  const bad = await req("/media/trim",{method:"POST",token,body:{mediaId:ticket.media.id,startSeconds:0,endSeconds:90},raw:true});
  console.log("TRIM_REJECT_90", bad.res.status, JSON.stringify(bad.json?.message||bad.json));
  // Also reject full 65s as reel clip >60
  const over = await req("/media/trim",{method:"POST",token,body:{mediaId:ticket.media.id,startSeconds:0,endSeconds:65},raw:true});
  console.log("TRIM_OVER_60", over.res.status, JSON.stringify(over.json?.message||over.json));
  const ok = await req("/media/trim",{method:"POST",token,body:{mediaId:ticket.media.id,startSeconds:0,endSeconds:15}});
  console.log("TRIM_OK", JSON.stringify({mediaId:ok.mediaId||ok.id||ok?.media?.id, durationSeconds:ok.durationSeconds, processingStatus:ok.processingStatus}));
  const otp = await req("/auth/otp/provider-status");
  console.log("OTP_STATUS", JSON.stringify(otp));
  const ice = await req("/calls/ice-servers",{token});
  console.log("ICE", JSON.stringify({stun:!!(ice.iceServers||ice)?.length || !!ice.urls, hint:ice.note||ice.turnHint||ice.message||null, keys:Object.keys(ice||{})}));
})().catch(e=>{console.error("FAIL", e.message); process.exit(1);});
