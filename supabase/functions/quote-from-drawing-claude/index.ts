import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Proxy for the Quote from Drawing tool: forwards one prompt (+ optional page image) to Claude (Anthropic API) and returns parsed JSON.
const ORIGINS=["https://evedesignandengineering.com","https://www.evedesignandengineering.com"];
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"});
const json=(x:unknown,s=200,o:string|null=null)=>new Response(JSON.stringify(x),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const counts=new Map<string,{n:number;until:number}>();
function allowed(r:Request){const k=r.headers.get("cf-connecting-ip")||r.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown",t=Date.now(),v=counts.get(k);if(!v||v.until<t){counts.set(k,{n:1,until:t+60000});return true}if(v.n>=6)return false;v.n++;return true}
function extractJson(t:string):any{t=t.trim();try{return JSON.parse(t)}catch(_){}const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(_){}}return null}
const MODELS=["claude-sonnet-5-5"];
Deno.serve(async(req:Request)=>{
 const o=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(o)});
 if(o&&!ORIGINS.includes(o))return json({error:"Origin not allowed."},403,o);
 if(req.method!=="POST")return json({error:"Use POST."},405,o);
 if(!allowed(req))return json({error:"Rate limit reached. Wait one minute and try again."},429,o);
 const key=Deno.env.get("ANTHROPIC_API_KEY");if(!key)return json({error:"ANTHROPIC_API_KEY is not set in Supabase secrets."},500,o);
 let body:any;try{body=await req.json()}catch(_){return json({error:"Invalid JSON body."},400,o)}
 const prompt=String(body?.prompt??"");if(prompt.length<20||prompt.length>400000)return json({error:"Prompt missing or too large."},400,o);
 const image=typeof body?.image==="string"?body.image.replace(/^data:image\/\w+;base64,/,""):"";if(image.length>6_000_000)return json({error:"Image too large."},413,o);
 const content:any[]=[];if(image)content.push({type:"image",source:{type:"base64",media_type:"image/jpeg",data:image}});
 content.push({type:"text",text:prompt+"\n\nReturn ONLY the JSON object, no markdown fences or commentary."});
 const start=Date.now();const statuses:number[]=[];
 for(const model of MODELS){
  if(Date.now()-start>120000)break;
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),110000);
  try{
   const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},signal:c.signal,body:JSON.stringify({model,max_tokens:16000,temperature:0,messages:[{role:"user",content}]})});
   if(!r.ok){statuses.push(r.status);console.error("[qfd-claude] provider",model,r.status,(await r.text()).slice(0,200));continue}
   const d=await r.json();const txt=(d.content||[]).map((x:any)=>x.text||"").join("");
   const obj=extractJson(txt);if(!obj||typeof obj!=="object"){statuses.push(422);console.error("[qfd-claude] bad json",model,d.stop_reason);continue}
   return json({result:obj,model},200,o);
  }catch(e){statuses.push(c.signal.aborted?408:503);console.error("[qfd-claude] error",model,String(e).slice(0,100))}
  finally{clearTimeout(timer)}
 }
 return json({error:"The AI service is busy or unavailable. Please try again in a few minutes.",statuses},503,o);
});
