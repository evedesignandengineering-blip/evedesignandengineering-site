import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Proxy for the Quote from Drawing tool: forwards one prompt (+ optional page image) to Gemini and returns parsed JSON.
// Only signed-in accounts with Create Quote access (public.qfd_check) may call it.
const ORIGINS=["https://evedesignandengineering.com","https://www.evedesignandengineering.com"];
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"});
const json=(x:unknown,s=200,o:string|null=null)=>new Response(JSON.stringify(x),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const counts=new Map<string,{n:number;until:number}>();
function allowed(r:Request){const k=r.headers.get("cf-connecting-ip")||r.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown",t=Date.now(),v=counts.get(k);if(!v||v.until<t){counts.set(k,{n:1,until:t+60000});return true}if(v.n>=6)return false;v.n++;return true}
async function authorised(r:Request){const a=r.headers.get("authorization")||"";if(!/^Bearer\s+\S+/i.test(a))return false;
 const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_ANON_KEY");if(!u||!k)return false;
 try{const x=await fetch(u+"/rest/v1/rpc/qfd_check",{method:"POST",headers:{apikey:k,Authorization:a,"Content-Type":"application/json"},body:"{}"});return x.ok&&(await x.json())===true}catch(_){return false}}
function extractJson(t:string):any{t=t.trim();try{return JSON.parse(t)}catch(_){}const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(_){}}return null}
const MODELS=["gemini-2.5-flash","gemini-3.5-flash-lite","gemini-3.1-flash-lite","gemini-2.5-flash-lite"];
Deno.serve(async(req:Request)=>{
 const o=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(o)});
 if(o&&!ORIGINS.includes(o))return json({error:"Origin not allowed."},403,o);
 if(req.method!=="POST")return json({error:"Use POST."},405,o);
 if(!(await authorised(req)))return json({error:"Sign in with an authorised account to use Create Quote."},401,o);
 if(!allowed(req))return json({error:"Rate limit reached. Wait one minute and try again."},429,o);
 const key=Deno.env.get("GEMINI_API_KEY");if(!key)return json({error:"AI key is not configured."},500,o);
 let body:any;try{body=await req.json()}catch(_){return json({error:"Invalid JSON body."},400,o)}
 const prompt=String(body?.prompt??"");if(prompt.length<20||prompt.length>400000)return json({error:"Prompt missing or too large."},400,o);
 const image=typeof body?.image==="string"?body.image.replace(/^data:image\/\w+;base64,/,""):"";if(image.length>6_000_000)return json({error:"Image too large."},413,o);
 const parts:any[]=[{text:prompt}];if(image)parts.push({inlineData:{mimeType:"image/jpeg",data:image}});
 const start=Date.now();const statuses:number[]=[];
 for(const model of MODELS){
  if(Date.now()-start>110000)break;
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),60000);
  try{
   const gen:any={temperature:0,maxOutputTokens:16000,responseMimeType:"application/json"};
   gen.thinkingConfig=model.startsWith("gemini-2.5")?{thinkingBudget:1024}:{thinkingLevel:"low"};
   const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"x-goog-api-key":key,"Content-Type":"application/json"},signal:c.signal,body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:gen})});
   if(!r.ok){statuses.push(r.status);console.error("[qfd] provider",model,r.status);continue}
   const d=await r.json();const txt=(d.candidates?.[0]?.content?.parts||[]).map((x:any)=>x.text||"").join("");
   const obj=extractJson(txt);if(!obj||typeof obj!=="object"){statuses.push(422);console.error("[qfd] bad json",model,d.candidates?.[0]?.finishReason);continue}
   return json({result:obj,model},200,o);
  }catch(e){statuses.push(c.signal.aborted?408:503);console.error("[qfd] error",model,String(e).slice(0,100))}
  finally{clearTimeout(timer)}
 }
 return json({error:"The AI service is busy or over its quota. Please try again in a few minutes.",statuses},503,o);
});
