import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const ORIGINS=["https://evedesignandengineering.com","https://www.evedesignandengineering.com"];
const cors=(o:string|null)=>({"Access-Control-Allow-Origin":o&&ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"});
const json=(x:unknown,s=200,o:string|null=null)=>new Response(JSON.stringify(x),{status:s,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const counts=new Map<string,{n:number;until:number}>();
function allowed(r:Request){const k=r.headers.get("cf-connecting-ip")||r.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown",t=Date.now(),v=counts.get(k);if(!v||v.until<t)counts.set(k,{n:1,until:t+60000});else if(v.n>=5)return false;else v.n++;return true;}
const clean=(v:unknown,m=120000)=>String(v??"").slice(0,m), norm=(v:unknown)=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const number=(v:unknown):number|null=>{if(typeof v==="number"&&Number.isFinite(v))return v;const m=String(v??"").replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;};
const codeOf=(x:any)=>String(x?.code??x?.item_code??x?.drawing_item??x?.quote_item??""),qtyOf=(x:any)=>number(x?.quantity??x?.qty??x?.quote_quantity);
const canonicalCode=(v:unknown)=>norm(String(v??"").replace(/CU$/i,""));
function extractProjectMetadata(drawing:string){
 const text=drawing.replace(/\r/g,"");
 const pick=(patterns:RegExp[])=>{for(const re of patterns){const m=text.match(re);if(m?.[1])return m[1].replace(/\s+/g," ").trim().replace(/[|,;]+$/,"");}return "";};
 const drawingNumber=pick([/(?:DRAWING|DRAWING\s+NO\.?|DWG\.?|DRG\.?)\s*(?:NUMBER|NO\.?|#|ID)?\s*[:#=-]?\s*([A-Z]{0,5}\d{5,8}[A-Z0-9/-]*)/i,/(\bSP\d{6}\b)/i]);
 const designer=pick([/(?:DESIGNED\s+BY|DRAWN\s+BY|DESIGNER)\s*[:=-]?\s*([^\n|]{2,70})/i]);
 const address=pick([/(?:SITE\s+ADDRESS|PROJECT\s+ADDRESS|WORKS\s+LOCATION|SITE\s+LOCATION|LOCATION)\s*[:=-]?\s*([^\n|]{5,140})/i]);
 const field=(value:string)=>value?{value,confidence:"high"}:undefined;
 const details:any={};if(drawingNumber)details.drawing_number=field(drawingNumber);if(designer)details.designer=field(designer);if(address)details.address=field(address);
 const lat=pick([/(?:LATITUDE|LAT)\s*[:=]?\s*(-?\d{1,2}\.\d{4,})/i]),lon=pick([/(?:LONGITUDE|LON|LONG)\s*[:=]?\s*(-?\d{1,3}\.\d{4,})/i]);
 const latNum=number(lat),lonNum=number(lon);
 return {project_details:details,geo_reference:Number.isFinite(latNum)&&Number.isFinite(lonNum)&&Math.abs(latNum!)<=90&&Math.abs(lonNum!)<=180?{latitude:latNum,longitude:lonNum,source:"explicit drawing coordinate"}:null};
}
function supplementDrawingInventory(r:any,drawing:string){
 if(!Array.isArray(r.drawing_items))r.drawing_items=[];
 const re=/\b((?:AUX[_-]?\d{3}|CN\d{1,3}(?:_[A-Z0-9]+)*(?:\/[A-Z0-9]+)*(?:CU)?|(?:LU|LV|HV)\d{1,3}_[A-Z0-9/]+|(?:TX|MP|UP|UM|U)\d+[A-Z0-9_-]*(?:\/[A-Z0-9_-]+)*|DCSH|OH[_-]?\d{2,3}(?:_[A-Z0-9-]+)*|CABLE[_ -]?07|DDRILL[_ -]?\d{2,3}))\s*[xX×]\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(m|km|ea|each)?\b/gi;
 for(const m of drawing.matchAll(re)){
  const code=m[1].trim(),quantity=number(m[2]);if(!code||quantity===null)continue;
  const key=canonicalCode(code),pos=m.index??0;
  const existing=r.drawing_items.find((d:any)=>canonicalCode(d?.code??d?.item_code)===key);
  const before=drawing.slice(Math.max(0,pos-45),pos),pageMatch=before.match(/\[PAGE\s+(\d+)\]/i),page=pageMatch?Number(pageMatch[1]):null;
  const evidence=drawing.slice(Math.max(0,pos-70),Math.min(drawing.length,pos+m[0].length+90)).replace(/\s+/g," ").trim();
  const unit=/^(m|km)$/i.test(m[3]||"")?(m[3].toLowerCase()):"EA";
  if(existing){
   if(qtyOf(existing)===null){existing.quantity=quantity;existing.unit=existing.unit||unit;existing.evidence=existing.evidence||evidence;existing.page=existing.page??page;existing.confidence="high";existing.quantity_method="explicit-code-x-quantity";}
   if(!existing.evidence)existing.evidence=evidence;
  }else{
   r.drawing_items.push({code,description:"Catalogue item read from explicit code × quantity notation",quantity,unit,evidence,page,confidence:"high",quantity_method:"explicit-code-x-quantity"});
  }
 }
}
async function ensureDepotCoordinates(r:any,drawing:string){
 const geo=r.geo_reference&&typeof r.geo_reference==="object"?r.geo_reference:{};
 let lat=number(geo.latitude??geo.lat),lon=number(geo.longitude??geo.lon??geo.lng);
 if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat!)<=90&&Math.abs(lon!)<=180){r.geo_reference={...geo,latitude:lat,longitude:lon};return;}
 const p=r.project_details&&typeof r.project_details==="object"?r.project_details:{};
 const addr=String(p.address?.value??p.address??"").trim();
 if(!addr||addr.length<6)return;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
 try{
  const url="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=au&q="+encodeURIComponent(addr);
  const response=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"EVE-Design-Quote-Checker/1.0 (project metadata lookup)","Accept":"application/json"}});
  if(!response.ok)return;const rows=await response.json();const found=rows?.[0];const glat=number(found?.lat),glon=number(found?.lon);
  if(Number.isFinite(glat)&&Number.isFinite(glon)&&Math.abs(glat!)<=90&&Math.abs(glon!)<=180)r.geo_reference={latitude:glat,longitude:glon,source:"geocoded drawing site address",matched_address:found.display_name||addr};
 }catch{}finally{clearTimeout(timer);}
}
function lineQty(s:string):number|null{const a=s.match(/(?:qty|quantity)\s*[:=]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);if(a)return number(a[1]);const b=s.match(/\bN\s+(\d+(?:,\d{3})*(?:\.\d+)?)(?=\s+(?:\d|Y\b|N\b|\$|\||$))/i);return b?number(b[1]):null;}
function rowFor(lines:string[],code:string){const c=norm(code);return lines.find(l=>lineQty(l)!==null&&l.split(/[|\t]+/).some(cell=>norm(cell.trim().split(/\s+/)[0])===c))||lines.find(l=>lineQty(l)!==null&&norm(l).startsWith(c))||null;}
function add(r:any,item:string,expected:number|null,actual:number|null,status:string,unit="EA",difference?:string){const c=norm(item);r.discrepancies=(r.discrepancies||[]).filter((d:any)=>!(d.status===status&&norm([d.drawing_item,d.quote_item].join(" ")).includes(c)));r.discrepancies.push({status,severity:"high",confidence:"high",drawing_item:item,drawing_quantity:expected,drawing_unit:unit,quote_item:item,quote_quantity:actual,quote_unit:unit,difference:difference||item+" expected "+expected+" "+unit+" but quote has "+actual+" "+unit+"."});}
async function reconcile(r:any,drawing:string,quote:string){
 for(const k of ["drawing_items","quote_items","discrepancies","matched_items","ignored_quote_extras","limitations"])if(!Array.isArray(r[k]))r[k]=[];
 const derived=extractProjectMetadata(drawing);
 if(!r.project_details||typeof r.project_details!=="object")r.project_details={};
 for(const k of ["drawing_number","designer","address"]){
  const item=(r.project_details as any)[k],derivedItem=(derived.project_details as any)[k];
  if(typeof item==="string"&&item.trim())(r.project_details as any)[k]={value:item.trim(),confidence:"medium"};
  else if(item&&typeof item==="object"&&typeof item.value==="string"&&item.value.trim()&&!item.confidence)item.confidence="medium";
  if(derivedItem&&(!(r.project_details as any)[k]||!String((r.project_details as any)[k].value||"").trim()))(r.project_details as any)[k]=derivedItem;
 }
 if(!r.geo_reference||typeof r.geo_reference!=="object")r.geo_reference=derived.geo_reference||{};
 else if(derived.geo_reference&&!Number.isFinite(number(r.geo_reference.latitude))&&!Number.isFinite(number(r.geo_reference.longitude)))r.geo_reference=derived.geo_reference;
 supplementDrawingInventory(r,drawing);
 await ensureDepotCoordinates(r,drawing);
 const lines=quote.split(/\r?\n/);
 for(const q of r.quote_items){const row=rowFor(lines,codeOf(q));if(row){const n=lineQty(row);if(n!==null){q.quantity=n;q.qty=n;q.quantity_confidence="high";q.quantity_evidence=row.slice(0,220);q.source_quantity_method="dqm-first-number-after-N";}}}
  // Recover quote rows directly from extracted DQM text so an abbreviated AI response cannot silently omit identifiable quote items.
  for(const line of lines){const trimmed=line.trim();if(!trimmed)continue;const code=trimmed.split(/\s+/)[0].replace(/[|,:;]+$/,"");const qty=lineQty(trimmed);if(!/^[A-Z][A-Z0-9_-]{1,}$/i.test(code)||qty===null)continue;if(r.quote_items.some((q:any)=>norm(codeOf(q))===norm(code)))continue;r.quote_items.push({code,description:trimmed.slice(code.length).trim().slice(0,240),quantity:qty,unit:"EA",quantity_confidence:"high",quantity_evidence:trimmed.slice(0,220),source_quantity_method:"dqm-first-number-after-N",confidence:"high"});}
 const find=(c:string)=>{const key=canonicalCode(c);const exact=r.quote_items.find((q:any)=>canonicalCode(codeOf(q))===key);if(exact)return exact;const partial=r.quote_items.filter((q:any)=>{const qk=canonicalCode(codeOf(q));return qk.startsWith(key)||key.startsWith(qk);});return partial.length===1?partial[0]:undefined;};
 for(const d of r.drawing_items){const c=String(d?.code??d?.item_code??"").trim();if(!c)continue;const q=find(c);if(!q){if(!lines.some(l=>norm(l.trim().split(/\s+/)[0])===norm(c))&&!r.discrepancies.some((x:any)=>x.status==="MISSING_FROM_QUOTE"&&norm(x.drawing_item)===norm(c)))r.discrepancies.push({status:"MISSING_FROM_QUOTE",severity:"high",confidence:d.confidence||"medium",drawing_item:c,drawing_quantity:qtyOf(d),drawing_unit:d.unit||null,quote_item:null,quote_quantity:null,quote_unit:null,difference:c+" appears on the drawing but was not found in the quote."});continue;}const a=qtyOf(d),b=qtyOf(q);if(a!==null&&b!==null&&a!==b){add(r,c,a,b,"QUANTITY_MISMATCH",String(d.unit||q.unit||"EA"));r.matched_items=r.matched_items.filter((m:any)=>norm(m.drawing_item)!==norm(c));}}
   // Audit extracted drawing text for catalogue-like codes omitted by the model's drawing inventory.
  // Catalogue codes in legend/schedule definitions are NOT evidence that the item is installed or required.
  const knownDrawingCodes=new Set(r.drawing_items.map((d:any)=>canonicalCode(d?.code??d?.item_code??"")).filter(Boolean));
  const candidateRe=/\b(?:AUX[_-]?\d{3}|CN\d{2,3}(?:_[A-Z0-9]+)*(?:\/[A-Z0-9]+)*(?:CU)?|(?:TX|MP|UP|UM|U)\d+[A-Z0-9_-]*(?:\/[A-Z0-9_-]+)*|DCSH|TRAV(?:EL)?[ _-]*(?:OH|UG)[_-]?\d{3}|OH[-_ ]?\d{2,3}(?:_[A-Z0-9-]+)*|CABLE[_ -]?07|DDRILL[_ -]?\d{2,3})\b/gi;
  const legendContext=(s:string)=>/(?:\bLEGEND\b|KEY\s+TO\s+(?:SYMBOLS|ABBREVIATIONS)|\bSYMBOLS\b|HV\s+CABLES|LV[- ]SL\s+CABLES|CABLES?\s*\(\s*SIZE\s+AND\s+TYPE\s+INDICATED|EARTH\s+STAKE|EXCLUSION\s+ZONE|STREET\s+BOUNDARY|CABLE\s+SCHEDULE|CN\d{2,3}\s*[-–:]\s*\d+\s*mm)/i.test(s);
  const candidateOccurrences=new Map<string,any[]>();
  for(const match of drawing.matchAll(candidateRe)){
    const code=match[0].trim(),key=canonicalCode(code);if(!key||knownDrawingCodes.has(key)||[...knownDrawingCodes].some(k=>k.startsWith(key)&&k.length>key.length))continue;
    const pos=match.index??0,from=Math.max(0,pos-110),to=Math.min(drawing.length,pos+170),rawEvidence=drawing.slice(from,to),evidence=rawEvidence.replace(/\s+/g," ").trim();
    const pageMatch=drawing.slice(Math.max(0,pos-40),pos).match(/\[PAGE\s+(\d+)\]/i),page=pageMatch?Number(pageMatch[1]):null;
    const occurrence={code,key,evidence,page,isLegend:legendContext(rawEvidence)};
    if(!candidateOccurrences.has(key))candidateOccurrences.set(key,[]);
    candidateOccurrences.get(key)!.push(occurrence);
  }
  for(const [key,occurrences] of candidateOccurrences){
    // Only flag a code when at least one occurrence is outside a legend/schedule definition.
    // If it appears in both places, use the non-legend occurrence as the evidence.
    const occurrence=occurrences.find(x=>!x.isLegend);
    if(!occurrence)continue;
    const {code,evidence,page}=occurrence;
    r.drawing_items.push({code,description:"Potential catalogue item omitted from AI inventory; verify source evidence",quantity:null,unit:null,evidence,page,confidence:"low"});
    if(!r.discrepancies.some((d:any)=>d.status==="REVIEW_REQUIRED"&&norm(d.drawing_item)===key&&/omitted from AI inventory/i.test(String(d.difference||"")))){
      const quoteItem=find(code);
      r.discrepancies.push({status:"REVIEW_REQUIRED",severity:"medium",confidence:"low",drawing_item:code,drawing_quantity:null,drawing_unit:null,quote_item:quoteItem?code:null,quote_quantity:quoteItem?qtyOf(quoteItem):null,quote_unit:quoteItem?.unit||null,difference:"Potential catalogue code "+code+" appears outside a detected legend/schedule context in extracted drawing text but was omitted from the AI drawing inventory. Confirm it is a genuine design item and verify its quantity against the drawing. Evidence: "+evidence});
    }
  }
  const pv=quote.match(/(?:project\s+value|value\s+of\s+works|total\s+project\s+value)\D{0,35}\$?\s*([\d,]+(?:\.\d{1,2})?)/i),project=pv?number(pv[1]):null;
 const a13=find("AUX_013"),a13r=rowFor(lines,"AUX_013"),a13q=a13?qtyOf(a13):a13r?lineQty(a13r):null;
 if(project!==null&&a13q!==null){const e=project<=50000?1:project<=200000?3:12;r.discrepancies=r.discrepancies.filter((d:any)=>d.status!=="AUX_013_PROJECT_VALUE_MISMATCH");if(a13q!==e)add(r,"AUX_013",e,a13q,"AUX_013_PROJECT_VALUE_MISMATCH","EA","AUX_013 expected "+e+" for project value $"+project+"; quote has "+a13q+".");}
 const cm=quote.match(/(?:total\s+internal\s+cost|internal\s+cost\s+total)\D{0,50}\$?\s*([\d,]+(?:\.\d{1,2})?)/i),cost=cm?number(cm[1]):null,a5=find("AUX_005"),a5r=rowFor(lines,"AUX_005"),a5q=(a5?qtyOf(a5):null)??(a5r?lineQty(a5r):null);
 r.discrepancies=r.discrepancies.filter((d:any)=>d.status!=="AUX_005_INTERNAL_COST_MISMATCH");if(cost!==null&&a5q!==null){const adj=cost-174.13*a5q,e=adj<=0?0:4*Math.ceil(adj/10000);if(a5q!==e)add(r,"AUX_005",e,a5q,"AUX_005_INTERNAL_COST_MISMATCH","EA","Total internal cost: $"+cost.toFixed(2)+". Less quoted AUX_005 allowance ($174.13 x "+a5q+" = $"+(174.13*a5q).toFixed(2)+") gives adjusted cost $"+adj.toFixed(2)+". Expected AUX_005 quantity: 4 x ceil($"+Math.max(0,adj).toFixed(2)+" / $10,000) = "+e+"; quote quantity: "+a5q+".");}else{const reason="AUX_005 calculation could not be completed because "+(cost===null?"the total internal cost was not confidently extracted":"the AUX_005 quote quantity was not confidently extracted")+(cost===null&&a5q===null?" and the AUX_005 quote quantity was not confidently extracted":"")+". The quote text must be checked; no expected quantity has been assumed. Evidence row: "+(a5r||"not confidently located")+". ";if(!r.discrepancies.some((d:any)=>d.status==="AUX_005_INTERNAL_COST_MISMATCH"))r.discrepancies.push({status:"AUX_005_INTERNAL_COST_MISMATCH",severity:"medium",confidence:"low",drawing_item:"N/A",drawing_quantity:null,drawing_unit:"EA",quote_item:"AUX_005",quote_quantity:a5q,quote_unit:"EA",difference:reason});else for(const d of r.discrepancies.filter((d:any)=>d.status==="AUX_005_INTERNAL_COST_MISMATCH")){d.difference=reason;d.confidence="low";d.severity="medium";d.quote_quantity=a5q;}}
 const cn=lines.filter(l=>/\bCN54[A-Z0-9_/-]*\b/i.test(l)&&lineQty(l)!==null);if(cn.length){const e=cn.reduce((s,l)=>s+2*(lineQty(l)||0),0),q=find("CABLE_07"),qr=rowFor(lines,"CABLE_07"),a=q?qtyOf(q):qr?lineQty(qr):null;if(a!==null&&a!==e)add(r,"CABLE_07",e,a,"CN54X_CABLE_07X_MISMATCH","EA","CN54x requires Cable_07 x2: expected "+e+" but quote has "+a+".");}
 // Recalculate travel allowances deterministically from drawing geo-reference and quote rows.
 const geo=r.geo_reference||{},lat=number(geo.latitude),lon=number(geo.longitude);
 const depots=[["Forrestdale",-32.136882,115.951940],["Rural Northam",-31.652603,116.697103],["Kalgoorlie",-30.787083,121.422549],["Vasse",-33.676915,115.234244],["Albany",-34.999186,117.866192],["Bridgetown",-33.954527,116.126206],["Picton",-33.352394,115.698416],["Katanning",-33.700739,117.530560],["Narrogin",-32.952570,117.190875],["Kondinin",-32.457851,118.265403],["Merredin",-31.491310,118.241399],["Geraldton",-28.768415,114.647471],["Jurien Bay",-30.297442,115.050616],["Moora",-30.630986,116.029825]];
 const radians=(n:number)=>n*Math.PI/180;
 const haversine=(a:number,b:number,c:number,d:number)=>{const x=radians(c-a),y=radians(d-b),v=Math.sin(x/2)**2+Math.cos(radians(a))*Math.cos(radians(c))*Math.sin(y/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
 if(Number.isFinite(lat)&&Number.isFinite(lon)){
   const nearest=depots.map(d=>({d,straight:haversine(lat,lon,d[1],d[2])})).sort((a,b)=>a.straight-b.straight).slice(0,3);
   const routes=await Promise.all(nearest.map(async x=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),4500);try{const u="https://router.project-osrm.org/route/v1/driving/"+lon+","+lat+";"+x.d[2]+","+x.d[1]+"?overview=false";const z=await fetch(u,{signal:c.signal});if(!z.ok)return null;const j=await z.json();const m=j.routes?.[0]?.distance;return typeof m==="number"?{name:x.d[0],distance_km:m/1000}:null;}catch{return null;}finally{clearTimeout(t);}}));
   const routed=routes.filter(Boolean).sort((a:any,b:any)=>a.distance_km-b.distance_km)[0] as any;
   if(routed){
     const roadKm=routed.distance_km,roundedRoadKm=Math.round(roadKm*10)/10;
     r.depot_travel={depot:routed.name,distance_km:roundedRoadKm,unrounded_distance_km:roundedRoadKm,source:"OSRM driving route"};
     const travelRows:any[]=[];
     for(const line of lines){const m=line.match(/\b(TRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+)\b/i);if(!m)continue;const code=m[1].replace(/\s+/g," ").toUpperCase();const q=lineQty(line);if(q!==null)travelRows.push({code,quantity:q});}
     for(const item of (r.quote_items||[])){const code=codeOf(item).toUpperCase().replace(/\s+/g," ");if(/\bTRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+\b/i.test(code)&&qtyOf(item)!==null&&!travelRows.some(x=>norm(x.code)===norm(code)))travelRows.push({code,quantity:qtyOf(item)});}
     for(const item of travelRows){const switching=/\bTRAV(?:EL)?\s*OH[_\s-]*0*007\b/i.test(item.code)||/switch(?:ing)?\s*crew/i.test(item.code);const factor=switching?6:2,expected=Math.round(roadKm*factor),actual=item.quantity,diff=Math.abs(actual-expected),tolerance=switching?15:5;
       r.discrepancies=(r.discrepancies||[]).filter((d:any)=>!(d.status==="DEPOT_TRAVEL_MISMATCH"&&norm(d.quote_item||d.drawing_item)===norm(item.code)));
       if(diff>=tolerance)add(r,item.code,expected,actual,"DEPOT_TRAVEL_MISMATCH","km","Quoted travel quantity differs from the expected allowance based on "+routed.name+" road distance ("+roundedRoadKm+" km x "+factor+" = "+expected+" km).");
     }
   }else{
     // Keep the nearest depot visible if OSRM is unavailable; never calculate travel allowance from straight-line distance.
     r.depot_travel={depot:nearest[0].d[0],distance_km:null,source:"nearest depot by straight-line; driving route unavailable"};
   }
 }
 // DDrill installed polypipe must equal the haul quantity for the same diameter.
 const diameter=(s:string):string|null=>{const u=s.toUpperCase().replace(/,/g,"");if(/\b400\s*HV\b/.test(u)||/\b160\s*MM\b/.test(u))return "160";if(/\b120\s*\/\s*240\s*MM\b/.test(u)||/\b110\s*MM\b/.test(u))return "110";if(/\b(?:1\s*\/\s*16\s*\/\s*25|25|16|1)\s*MM\b/.test(u)||/\b63\s*MM\b/.test(u))return "63";return null;};
 const drillRows=lines.filter(l=>/(?:DDRILL|DIRECTIONAL\s*DRILL|D.?DRILL)/i.test(l)&&lineQty(l)!==null);
 const haulRows=lines.filter(l=>/\bHAUL\b/i.test(l)&&lineQty(l)!==null);
 for(const drill of drillRows){const dia=diameter(drill);if(!dia)continue;const haul=haulRows.find(l=>diameter(l)===dia);if(!haul){if(!r.discrepancies.some((d:any)=>d.status==="REVIEW_REQUIRED"&&/haul/i.test(String(d.difference))&&String(d.difference).includes(dia)))r.discrepancies.push({status:"REVIEW_REQUIRED",severity:"medium",confidence:"medium",drawing_item:"N/A",drawing_quantity:null,drawing_unit:"m",quote_item:"DDrill haul "+dia+"mm",quote_quantity:null,quote_unit:"m",difference:"DDrill installed polypipe is listed for "+dia+"mm, but a matching haul row could not be confidently identified. Verify the quote."});continue;}const a=lineQty(drill),b=lineQty(haul);if(a!==null&&b!==null&&a!==b)add(r,"DDrill haul "+dia+"mm",a,b,"DRILL_HAUL_QUANTITY_MISMATCH","m","DDrill installation and haul quantities for "+dia+"mm polypipe must match; install is "+a+" m and haul is "+b+" m.");}
 // Check mapped polypipe diameters only where the drawing and quote explicitly identify a drill/polypipe line.
 const drawingLines=drawing.split(/\r?\n/);
 for(const dl of drawingLines.filter(l=>/(?:DDRILL|DIRECTIONAL\s*DRILL|POLYPIPE|POLY\s*PIPE)/i.test(l))){
   const mapped=diameter(dl);if(!mapped)continue;
   const code=(dl.trim().split(/\s+/)[0]||"");
   const qline=lines.find(l=>/(?:DDRILL|DIRECTIONAL\s*DRILL|POLYPIPE|POLY\s*PIPE)/i.test(l)&&(!code||norm(l).includes(norm(code))));
   if(!qline)continue;
   const qdia=diameter(qline);
   if(qdia&&qdia!==mapped)add(r,code||"Polypipe size",Number(mapped),Number(qdia),"POLYPIPE_SIZE_MISMATCH","mm","Drawing pipe size maps to "+mapped+"mm for construction, but the quote row appears to specify "+qdia+"mm.");
 }
 r.summary=clean(r.summary,1200);r.human_review_required=true;r.ai_powered=true;r.note="AI-assisted comparison only. Verify all codes, quantities and source pages against the original documents before accepting a quote.";r.diagnostics={quote_quantity_rule:"first number after standalone N",source_rows_reconciled:r.quote_items.filter((q:any)=>q.source_quantity_method==="dqm-first-number-after-N").length};return r;
}
function extractJsonObject(s:string):any{
 const text=s.replace(/^\x60{3}[a-z]*\s*/i,"").replace(/\s*\x60{3}$/,"").trim();
 for(let start=0;start<text.length;start++){
  if(text[start]!=="{")continue;
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<text.length;i++){
   const ch=text[i];
   if(inString){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')inString=false;continue;}
   if(ch==='"'){inString=true;continue;}
   if(ch==="{")depth++;
   else if(ch==="}"){depth--;if(depth===0){try{const v=JSON.parse(text.slice(start,i+1));if(v&&typeof v==="object"&&!Array.isArray(v))return v;}catch{}break;}}
  }
 }
 return null;
}
function cuCompact(value:string):string {
 return String(value??"").replace(/\r/g,"").split("\n").map(line=>line.replace(/[\t ]{2,}/g," ").trim()).filter(Boolean).join("\n").replace(/\n{3,}/g,"\n\n");
}
function cuNorm(value:unknown):string { return String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,""); }
function cuPageAt(text:string,index:number):number|null {
 const matches=Array.from(text.slice(0,Math.max(0,index)).matchAll(/\[PAGE\s+(\d+)\]/gi));
 return matches.length?Number(matches[matches.length-1][1]):null;
}
function cuIsNonCuLabel(text:string,index:number):boolean {
 return /NON\s*$/i.test(text.slice(Math.max(0,index-8),index));
}
function cuExtractDrawingItems(input:string):any[] {
 const text=cuCompact(input),all=Array.from(text.matchAll(/\bCU\s*:/gi));
 const markers=all.filter(m=>!cuIsNonCuLabel(text,m.index??0));
 const pattern=/\b((?:(?:TRAV|OH|UG)\s+)?[A-Z][A-Z0-9_.\/-]*\d[A-Z0-9_.\/-]*)\s*[x×]\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(km|m)?\b/gi;
 const items=new Map<string,any>();
 markers.forEach((marker,mi)=>{
  const start=marker.index??0,next=markers[mi+1];let end=next?(next.index??text.length):text.length;
  const after=text.slice(start+marker[0].length,end),stop=/\b(?:NON\s*CU|DCSH)\s*:/i.exec(after);
  if(stop)end=start+marker[0].length+stop.index;
  const block=text.slice(start,end),headerPage=cuPageAt(text,start);
  for(const match of block.matchAll(pattern)){
   const code=match[1].toUpperCase().trim(),quantity=Number(match[2].replace(/,/g,""));
   if(!code||!Number.isFinite(quantity))continue;
   const unit=(match[3]||"EA").toLowerCase(),key=cuNorm(code),at=(match.index??0)+start,page=cuPageAt(text,at)??headerPage;
   const evidence=text.slice(Math.max(start,at-48),Math.min(end,at+match[0].length+60)).replace(/\s+/g," ").trim().slice(0,260);
   if(!items.has(key))items.set(key,{code,description:"CU item explicitly listed in a drawing CU callout",quantity:0,unit,page,source_pages:[],evidence_parts:[],occurrences:0,confidence:"high"});
   const item=items.get(key);item.quantity+=quantity;if(item.unit!==unit)item.unit="mixed";
   if(page!==null&&!item.source_pages.includes(page))item.source_pages.push(page);
   if(evidence&&!item.evidence_parts.includes(evidence))item.evidence_parts.push(evidence);
   item.occurrences++;
  }
 });
 return Array.from(items.values()).map(item=>({...item,quantity:Math.round(item.quantity*1000)/1000,evidence:item.evidence_parts.slice(0,4).join(" | ").slice(0,900),evidence_parts:undefined}));
}
function cuQuoteQty(line:string):number|null {
 const cells=line.split("|").map(cell=>cell.trim());
 for(let i=0;i<cells.length-1;i++){if(/^N$/i.test(cells[i])){const q=cells[i+1].replace(/,/g,"").match(/^\d+(?:\.\d+)?$/);if(q)return Number(q[0]);}}
 const m=/\bN\s*(?:\|\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\b/i.exec(line);
 return m?Number(m[1].replace(/,/g,"")):null;
}
function cuExtractQuoteItems(input:string):any[] {
 const text=cuCompact(input),heading=text.lastIndexOf("Compatible Units");
 if(heading<0)return [];
 const tableStart=text.indexOf("SCU Type",heading),start=tableStart>=0?tableStart:heading,after=text.slice(start);
 const stop=/Non\s+Compatible\s+Unit\s+Items/i.exec(after),table=stop?after.slice(0,stop.index):after,items=new Map<string,any>();
 for(const raw of table.split("\n")){
  const line=raw.trim();if(!line||/^(?:SCU\s+Type|Compatible\s+Units|CU\s+Name)\b/i.test(line))continue;
  const first=line.split("|")[0].trim(),m=/^((?:(?:TRAV|OH|UG)\s+)?[A-Z][A-Z0-9_.\/-]*\d[A-Z0-9_.\/-]*)\b/i.exec(first);
  if(!m)continue;
  const quantity=cuQuoteQty(line);if(quantity===null||!Number.isFinite(quantity))continue;
  const code=m[1].toUpperCase(),key=cuNorm(code),cells=line.split("|").map(x=>x.trim());
  const description=(cells.length>1?cells[1]:line.slice(m[0].length)).replace(/\s+/g," ").trim().slice(0,220);
  if(!items.has(key))items.set(key,{code,description,quantity:0,unit:null,page:cuPageAt(text,text.indexOf(line,start)),source_pages:[],row_count:0,evidence_parts:[],confidence:"high"});
  const item=items.get(key);item.quantity+=quantity;item.row_count++;
  const page=cuPageAt(text,text.indexOf(line,start));if(page!==null&&!item.source_pages.includes(page))item.source_pages.push(page);
  if(!item.evidence_parts.includes(line))item.evidence_parts.push(line.slice(0,260));
  if(!item.description&&description)item.description=description;
 }
 return Array.from(items.values()).map(item=>({...item,quantity:Math.round(item.quantity*1000)/1000,evidence:item.evidence_parts.slice(0,3).join(" | ").slice(0,800),evidence_parts:undefined}));
}
function cuResolve(d:any,quoteMap:Map<string,any>,drawingKeys:Set<string>):any|null {
 const key=cuNorm(d.code);
 if(quoteMap.has(key))return {key,confidence:"high",note:"Exact catalogue code match."};
 if(key.endsWith("CU")&&quoteMap.has(key.slice(0,-1)))return {key:key.slice(0,-1),confidence:"medium",note:"Matched DQM CU Name where the final U in CU is clipped in the report text."};
 const pole=key.startsWith("P09M")?key.replace(/^P09M/,"PO9M"):null;
 if(pole&&quoteMap.has(pole))return {key:pole,confidence:"medium",note:"Matched drawing P09_M spelling to DQM PO9_M."};
 if(key===cuNorm("LU61_25_240")&&drawingKeys.has(cuNorm("LU61_25_240U"))&&quoteMap.has(key+"O")&&quoteMap.has(key+"U"))return {key:key+"O",confidence:"medium",note:"Resolved unqualified LU61_25_240 to its overhead O variant because U is listed separately."};
 const candidates=Array.from(quoteMap.keys()).filter(candidate=>candidate.startsWith(key)||key.startsWith(candidate));
 return candidates.length===1?{key:candidates[0],confidence:"medium",note:"Matched a unique DQM code variant with a truncated or omitted suffix."}:null;
}
function cuAIItems(input:any,drawing:boolean):any[] {
 const raw=Array.isArray(input)?input:[],filtered=raw.filter(item=>{
  if(!item||!item.code||!Number.isFinite(Number(item.quantity)))return false;
  if(drawing){const ev=String(item.evidence||"");return /\bCU\s*:/i.test(ev)&&!/\bNON\s*CU\s*:|\bDCSH\s*:/i.test(ev);}
  return true;
 });
 const map=new Map<string,any>();
 for(const item of filtered){const key=cuNorm(item.code);if(!key)continue;
  if(!map.has(key))map.set(key,{...item,code:String(item.code).toUpperCase(),quantity:0,occurrences:0,row_count:0,confidence:item.confidence||"medium"});
  const target=map.get(key);target.quantity+=Number(item.quantity);target.occurrences++;target.row_count++;if(!target.evidence&&item.evidence)target.evidence=item.evidence;
 }
 return Array.from(map.values());
}
async function cuCalculateDepotTravel(report:any,drawingText:string,quoteText:string):Promise<void> {
 const derived=extractProjectMetadata(drawingText);
 if(!report.project_details||typeof report.project_details!=="object")report.project_details={};
 for(const key of ["drawing_number","designer"]){if(derived.project_details?.[key]&&!report.project_details[key])report.project_details[key]=derived.project_details[key];}
 const headerField=(label:RegExp):string=>{
  for(const rawLine of quoteText.split(/\r?\n/)){
   const parts=rawLine.split("|").map(part=>part.trim());
   for(let i=0;i<parts.length;i++){
    const match=parts[i].match(label);if(!match)continue;
    const inline=String(match[1]||"").replace(/\*+/g,"").trim();
    if(inline&&!/^(?:Quote Version|Option|Issue Date|Approval|Design Office|Construction Branch|Work Driver|Underlying Cause)\s*:/i.test(inline))return inline;
    for(let j=i+1;j<parts.length;j++){
     const candidate=parts[j].replace(/\*+/g,"").trim();
     if(!candidate||/^(?:Quote Version|Option|Issue Date|Approval|Design Office|Construction Branch|Work Driver|Underlying Cause)\s*:/i.test(candidate))break;
     return candidate;
    }
   }
  }
  return "";
 };
 const title=headerField(/^\s*Job\s+Title\s*:\s*(.*)$/i).replace(/\s+/g," ").trim();
 const quoteAddress=headerField(/^\s*Address\s*:\s*(.*)$/i).replace(/\s+/g," ").trim();
 const titleLooksLikeAddress=/\b\d+\s+.+\b(?:ST|STREET|RD|ROAD|DR|DRIVE|AVE|AVENUE|HWY|HIGHWAY|CT|COURT|CRES|CRESCENT|WAY|LN|LANE)\b/i.test(title);
 const existingAddress=String(report.project_details.address?.value??report.project_details.address??"").trim();
 const isDrawingLabel=/\b(?:LOCATION\s+PLAN|SITE\s+PLAN|AREA\s+PLAN|KEY\s+PLAN)\b/i.test(existingAddress);
 const selectedAddress=titleLooksLikeAddress?title:quoteAddress||title;
 const preferredAddress=selectedAddress?selectedAddress+( /\bWA\b/i.test(selectedAddress)?"":", WA"):"";
 if((!existingAddress||isDrawingLabel)&&preferredAddress)report.project_details.address={value:preferredAddress,confidence:"high",source:"DQM quote job title/address"};
 else if(!report.project_details.address&&preferredAddress)report.project_details.address={value:preferredAddress,confidence:"medium",source:"DQM quote job title/address"};
 if(!report.geo_reference||typeof report.geo_reference!=="object")report.geo_reference=derived.geo_reference||{};
 else if(derived.geo_reference&&!Number.isFinite(number(report.geo_reference.latitude))&&!Number.isFinite(number(report.geo_reference.longitude)))report.geo_reference=derived.geo_reference;
 await ensureDepotCoordinates(report,drawingText);
 const geo=report.geo_reference||{},lat=number(geo.latitude??geo.lat),lon=number(geo.longitude??geo.lon??geo.lng);
 const travelItems=(Array.isArray(report.quote_items)?report.quote_items:[]).filter((item:any)=>/\bTRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+\b/i.test(String(item.code??item.item_code??""))&&Number.isFinite(number(item.quantity??item.qty)));
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat!)>90||Math.abs(lon!)>180){
  report.depot_travel={depot_name:"Not determined",depot:"Not determined",distance_km:null,source:"site coordinates unavailable"};
  report.travel_allowance_check={status:"NEEDS_LOCATION",travel_items_found:travelItems.length,message:"Could not establish reliable project coordinates from the drawing/quote address; no straight-line travel quantity has been substituted."};
  if(!Array.isArray(report.limitations))report.limitations=[];
  report.limitations.push("Depot travel could not be calculated because a reliable project location could not be established.");
  return;
 }
 const depots:[string,number,number][]=[
  ["Forrestdale",-32.136882,115.951940],["Rural Northam",-31.652603,116.697103],["Kalgoorlie",-30.787083,121.422549],
  ["Vasse",-33.676915,115.234244],["Albany",-34.999186,117.866192],["Bridgetown",-33.954527,116.126206],
  ["Picton",-33.352394,115.698416],["Katanning",-33.700739,117.530560],["Narrogin",-32.952570,117.190875],
  ["Kondinin",-32.457851,118.265403],["Merredin",-31.491310,118.241399],["Geraldton",-28.768415,114.647471],
  ["Jurien Bay",-30.297442,115.050616],["Moora",-30.630986,116.029825]
 ];
 const radians=(n:number)=>n*Math.PI/180;
 const haversine=(a:number,b:number,c:number,d:number)=>{const x=radians(c-a),y=radians(d-b),v=Math.sin(x/2)**2+Math.cos(radians(a))*Math.cos(radians(c))*Math.sin(y/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
 const nearest=depots.map(d=>({d,straight:haversine(lat!,lon!,d[1],d[2])})).sort((a,b)=>a.straight-b.straight).slice(0,3);
 const routes=await Promise.all(nearest.map(async x=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
   const url="https://router.project-osrm.org/route/v1/driving/"+lon+","+lat+";"+x.d[2]+","+x.d[1]+"?overview=false";
   const response=await fetch(url,{signal:controller.signal});
   if(!response.ok)return null;
   const data=await response.json(),metres=data.routes?.[0]?.distance;
   return typeof metres==="number"?{name:x.d[0],distance_km:metres/1000}:null;
  }catch{return null;}finally{clearTimeout(timer);}
 }));
 const routed=routes.filter(Boolean).sort((a:any,b:any)=>a.distance_km-b.distance_km)[0] as any;
 if(!routed){
  report.depot_travel={depot_name:nearest[0].d[0],depot:nearest[0].d[0],distance_km:null,source:"nearest depot by coordinates; driving route unavailable"};
  report.travel_allowance_check={status:"NEEDS_ROUTE",travel_items_found:travelItems.length,message:"OSRM driving route was unavailable. No straight-line distance was used to calculate travel quantities."};
  if(!Array.isArray(report.limitations))report.limitations=[];
  report.limitations.push("Depot was approximated from project coordinates, but driving distance was unavailable; travel quantities were not calculated.");
  return;
 }
 const roadKm=routed.distance_km,roundedRoadKm=Math.round(roadKm*10)/10;
 report.depot_travel={depot_name:routed.name,depot:routed.name,distance_km:roundedRoadKm,unrounded_distance_km:roadKm,source:"OSRM driving route",project_latitude:lat,project_longitude:lon};
 report.travel_allowance_check={status:"CHECKED",travel_items_found:travelItems.length,road_distance_km:roundedRoadKm,formula:"standard OH/UG travel = road km × 2; switching crew TRAV OH_007 = road km × 6; expected quantities rounded to whole km."};
 let mismatchCount=0;
 for(const item of travelItems){
  const code=String(item.code??item.item_code),quantity=number(item.quantity??item.qty);
  if(quantity===null)continue;
  const switching=/\bTRAV(?:EL)?\s*OH[_\s-]*0*007\b/i.test(code)||/switch(?:ing)?\s*crew/i.test(String(item.description||""));
  const factor=switching?6:2,expected=Math.round(roadKm*factor),difference=Math.abs(quantity-expected),tolerance=switching?15:5;
  if(difference<tolerance)continue;
  mismatchCount++;
  report.discrepancies.push({status:"DEPOT_TRAVEL_MISMATCH",severity:"high",confidence:"high",drawing_item:"Depot travel allowance",drawing_quantity:expected,drawing_unit:"km",expected_quantity:expected,expected_unit:"km",quote_item:code,quote_quantity:quantity,quote_unit:"km",difference:"Quoted travel allowance does not match the nearest depot driving distance. "+routed.name+" road route: "+roundedRoadKm+" km × "+factor+" = "+expected+" km expected; quote has "+quantity+" km."});
 }
 report.travel_allowance_check.mismatches=mismatchCount;
 report.travel_allowance_check.message=mismatchCount?mismatchCount+" travel allowance(s) differ from the calculated driving-distance allowance.":"Travel allowance quantities are within the existing tolerance.";
 if(Array.isArray(report.ignored_quote_extras))report.ignored_quote_extras=report.ignored_quote_extras.filter((x:any)=>!/\bTRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+\b/i.test(String(x.item||"")));
 if(mismatchCount)report.summary+=" Depot travel check: "+mismatchCount+" allowance mismatch(es) based on "+roundedRoadKm+" km road distance from "+routed.name+".";
}

function cuCompare(drawingItems:any[],quoteItems:any[],meta:any={}):any {
 const quoteMap=new Map<string,any>(quoteItems.map((item:any)=>[cuNorm(item.code),item] as [string,any])),drawingKeys=new Set<string>(drawingItems.map((item:any)=>cuNorm(item.code)));
 const discrepancies:any[]=[],matched:any[]=[],used=new Set<string>();
 for(const d of drawingItems){
  const resolved=cuResolve(d,quoteMap,drawingKeys),q=resolved?quoteMap.get(resolved.key):null;
  if(!q){discrepancies.push({status:"MISSING_FROM_QUOTE",severity:"high",confidence:d.confidence||"high",drawing_item:d.code,drawing_quantity:d.quantity,drawing_unit:d.unit||"EA",expected_quantity:d.quantity,expected_unit:d.unit||"EA",quote_item:null,quote_quantity:null,quote_unit:d.unit||"EA",difference:d.code+" is explicitly listed in the drawing CU callout(s) but is not present in the DQM Compatible Units table."});continue;}
  used.add(resolved.key);const expected=Number(d.quantity),actual=Number(q.quantity),unit=d.unit||"EA";
  if(Math.abs(expected-actual)>1e-9)discrepancies.push({status:"QUANTITY_MISMATCH",severity:"high",confidence:resolved.confidence,drawing_item:d.code,drawing_quantity:expected,drawing_unit:unit,expected_quantity:expected,expected_unit:unit,quote_item:q.code,quote_quantity:actual,quote_unit:q.unit||unit,difference:"Drawing CU callout(s) total "+expected+" "+unit+" across "+(d.occurrences||1)+" occurrence(s); DQM Compatible Units rows total "+actual+" across "+(q.row_count||1)+" row(s). "+resolved.note});
  else matched.push({drawing_item:d.code,drawing_quantity:expected,quote_item:q.code,quote_quantity:actual,note:resolved.note,confidence:resolved.confidence});
 }
 const extras=quoteItems.filter(item=>!used.has(cuNorm(item.code))).map(item=>({item:item.code,quantity:item.quantity,reason:"Quote-only Compatible Unit not listed in drawing CU callouts; ignored as requested."}));
 const missing=discrepancies.filter(x=>x.status==="MISSING_FROM_QUOTE").length,qty=discrepancies.filter(x=>x.status==="QUANTITY_MISMATCH").length;
 return {summary:discrepancies.length?"CU-only comparison complete: "+drawingItems.length+" unique drawing CU codes; "+matched.length+" quantities match; "+qty+" quantity mismatch(es); "+missing+" drawing CU code(s) missing from the DQM Compatible Units table. Quote-only CUs are ignored as discrepancies.":"CU-only comparison complete: all "+drawingItems.length+" unique drawing CU codes match the DQM Compatible Units table by quantity. Quote-only CUs are ignored as discrepancies.",comparison_scope:"CU-only: drawing CU callouts compared against DQM Compatible Units; NON CU and DCSH notes excluded.",drawing_items:drawingItems.map(item=>({...item,source_page:item.page,unit:item.unit||"EA"})),quote_items:quoteItems.map(item=>({...item,source_page:item.page})),discrepancies,matched_items:matched,ignored_quote_extras:extras,limitations:["Only explicit entries under drawing CU: callouts are counted. NON CU and DCSH note blocks are excluded.","Repeated code quantities are totalled across drawing CU callouts and repeated DQM Compatible Units rows.","Known abbreviated/variant codes are matched only by explicit rules or a unique quote-code prefix; ambiguous matches are flagged missing for review.","Verify final CU quantities and code variants against the original PDFs before quote acceptance."],human_review_required:true,ai_powered:false,diagnostics:{mode:"deterministic-cu-reconciliation",drawing_cu_unique_count:drawingItems.length,quote_cu_unique_count:quoteItems.length,matched_count:matched.length,discrepancy_count:discrepancies.length,drawing_cu_occurrences:drawingItems.reduce((n,item)=>n+(item.occurrences||1),0),quote_rows_aggregated:quoteItems.reduce((n,item)=>n+(item.row_count||1),0),...meta},note:"Quantities are reconciled from explicit drawing CU callouts and the DQM Compatible Units table. Verify any reported difference against the source PDFs before approval."};
}

Deno.serve(async(req:Request)=>{
 const o=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:cors(o)});if(o&&!ORIGINS.includes(o))return json({error:"Origin not allowed."},403,o);if(req.method!=="POST")return json({error:"Use POST."},405,o);if(!allowed(req))return json({error:"Rate limit reached. Wait one minute before retrying."},429,o);
 const key=Deno.env.get("GEMINI_API_KEY"),nvidiaKey=Deno.env.get("NVIDIA_API_KEY");
 let b:any;try{b=await req.json();}catch{return json({error:"Expected JSON request body."},400,o);}const dt=clean(b.drawingText),qt=clean(b.quoteText),scope=clean(b.scope,8000),di=Array.isArray(b.drawingImages)?b.drawingImages.slice(0,7):[],qi=Array.isArray(b.quoteImages)?b.quoteImages.slice(0,5):[];
 if(!dt.trim()&&!di.length)return json({error:"No readable drawing text or page images were provided."},400,o);if(!qt.trim()&&!qi.length)return json({error:"No readable quote text or page images were provided."},400,o);
 const parsedDrawingCu=cuExtractDrawingItems(dt),parsedQuoteCu=cuExtractQuoteItems(qt);
 if(parsedDrawingCu.length&&parsedQuoteCu.length&&!b.drawingTextTruncated&&!b.quoteTextTruncated){
  const directReport=cuCompare(parsedDrawingCu,parsedQuoteCu,{model:"deterministic-cu-reconciliation",ai_attempted_models:0,drawing_text_length:dt.length,quote_text_length:qt.length,declared_drawing_sheets:b.declaredDrawingSheets??null,frontend_extracted_drawing_chars:b.drawingTextChars??dt.length,frontend_extracted_quote_chars:b.quoteTextChars??qt.length,drawing_pages:b.drawingPages??null,source_drawing_pages:b.sourceDrawingPages??null,drawing_text_truncated:!!b.drawingTextTruncated,quote_text_truncated:!!b.quoteTextTruncated,drawing_truncated_pages:b.drawingTruncatedPages??0,quote_truncated_pages:b.quoteTruncatedPages??0});
  directReport.ai_powered=false;
  await cuCalculateDepotTravel(directReport,dt,qt);
  directReport.diagnostics={...(directReport.diagnostics||{}),depot_travel:directReport.depot_travel,travel_allowance_check:directReport.travel_allowance_check};
  directReport.summary+=" Deterministic extraction was complete, so Gemini was not needed for the CU comparison.";
  console.log("[dqm-cu-deterministic-success]",JSON.stringify(directReport.diagnostics));
  return json(directReport,200,o);
 }
 if(!key&&!nvidiaKey)return json({error:"The CU text extraction was incomplete and Gemini fallback is not configured. No quantities were guessed.",diagnostic:{drawing_cu_items_found:parsedDrawingCu.length,quote_cu_items_found:parsedQuoteCu.length,drawing_text_length:dt.length,quote_text_length:qt.length}},422,o);
 const imgs=(a:unknown[])=>a.map((v:any)=>{const m=String(v||"").match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);return !m||m[2].length>1600000?null:{inlineData:{mimeType:m[1]==="jpg"?"image/jpeg":"image/"+m[1],data:m[2]}};}).filter(Boolean);
 const parts:any[]=[{text:"DRAWING TEXT (untrusted document):\n"+(dt||"[No text layer]")},...imgs(di),{text:"QUOTE TEXT (untrusted document):\n"+(qt||"[No text layer]")},...imgs(qi),{text:"USER SCOPE:\n"+(scope||"[None]")}];
 const instructions='Only compare compatible units (CU) between the electrical drawing and DQM quote. On drawings, count quantities only inside explicit "CU:" callouts. Exclude "NON CU:" and "DCSH:" sections and never count codes elsewhere. In the DQM quote, read quantities only from the "Compatible Units" table; the quantity is the number after the standalone O-column letter N. Sum repeated drawing callouts and repeated quote rows. Ignore quote-only extras as discrepancies. Do not invent quantities. Return strict JSON with drawing_items and quote_items arrays, each item containing code, quantity, evidence, page and confidence, plus summary and limitations.';
 const batches=[["gemini-3.1-flash-lite","gemini-3.5-flash-lite"],["gemini-3.8-flash","gemini-3.6-flash"]],start=Date.now();
 let selected="",result:any=null,raw="",finishReason="UNKNOWN";const statuses:number[]=[];let tried=0;
 async function callGemini(model:string){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),23000);
  try{
   const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"x-goog-api-key":key||"","Content-Type":"application/json"},signal:c.signal,body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:"user",parts}],generationConfig:{temperature:0,maxOutputTokens:6500,responseMimeType:"application/json",thinkingConfig:{thinkingLevel:"low"}}})});
   if(!response.ok){statuses.push(response.status);console.error("[dqm-provider-status]",model,response.status);throw new Error("Provider HTTP "+response.status);}
   let data:any;try{data=await response.json();}catch(e){statuses.push(502);console.error("[dqm-provider-invalid-json]",model,String(e).slice(0,100));throw new Error("Invalid provider JSON");}
   const candidate=data.candidates?.[0],textOut=(candidate?.content?.parts||[]).map((x:any)=>x.text||"").join("").trim();
   const obj=extractJsonObject(textOut),reason=candidate?.finishReason||"UNKNOWN";
   if(!obj||typeof obj!=="object"||Array.isArray(obj)){finishReason=reason;console.error("[dqm-invalid-structured-response]",model,reason,textOut.length);throw new Error("No valid structured comparison");}
   return {model,obj,textOut,reason};
  }catch(e){
   if(c.signal.aborted){statuses.push(408);console.error("[dqm-provider-timeout]",model,"23s timeout");}
   else if(!(e instanceof Error && e.message.startsWith("Provider HTTP ")) && !(e instanceof Error && (e.message==="Invalid provider JSON"||e.message==="No valid structured comparison"))){statuses.push(503);console.error("[dqm-provider-error]",model,String(e).slice(0,120));}
   throw e;
  }finally{clearTimeout(timer);}
 }
 for(const batch of batches){
  if(result||Date.now()-start>62000)break;
  tried+=batch.length;
  console.log("[dqm-model-batch-start]",batch.join(","));
  const outcomes=await Promise.allSettled(batch.map(model=>callGemini(model)));
  const success=outcomes.find((x:any)=>x.status==="fulfilled") as PromiseFulfilledResult<any>|undefined;
  if(success){result=success.value.obj;raw=success.value.textOut;selected=success.value.model;finishReason=success.value.reason;console.log("[dqm-model-batch-success]",selected);}
  else console.error("[dqm-model-batch-failed]",batch.join(","));
 }
 if(!result)return json({error:"The CU tables could not be read reliably from both PDFs. No quantity comparison was generated, to avoid false discrepancies.",attempted_models:tried,diagnostic:{drawing_cu_items_found:parsedDrawingCu.length,quote_cu_items_found:parsedQuoteCu.length,finishReason,elapsed_ms:Date.now()-start,provider_statuses:statuses,model_batches:batches}},422,o);
 const aiDrawingCu=b.drawingTextTruncated?cuAIItems(result.drawing_items,true):(parsedDrawingCu.length?parsedDrawingCu:cuAIItems(result.drawing_items,true));
 const aiQuoteCu=b.quoteTextTruncated?cuAIItems(result.quote_items,false):(parsedQuoteCu.length?parsedQuoteCu:cuAIItems(result.quote_items,false));
 if(!aiDrawingCu.length||!aiQuoteCu.length)return json({error:"Gemini returned a response, but one CU inventory was not sufficiently evidenced. No quantity comparison was generated.",diagnostic:{drawing_cu_items_found:aiDrawingCu.length,quote_cu_items_found:aiQuoteCu.length,model:selected,finishReason,provider_statuses:statuses}},422,o);
 const fallbackReport=cuCompare(aiDrawingCu,aiQuoteCu,{model:selected,ai_fallback_used:true,ai_attempted_models:tried,model_elapsed_ms:Date.now()-start,drawing_text_length:dt.length,quote_text_length:qt.length});
 fallbackReport.ai_powered=true;
 await cuCalculateDepotTravel(fallbackReport,dt,qt);
 fallbackReport.diagnostics={...(fallbackReport.diagnostics||{}),depot_travel:fallbackReport.depot_travel,travel_allowance_check:fallbackReport.travel_allowance_check};
 fallbackReport.limitations.unshift("Text-based CU extraction was incomplete or clipped; Gemini's CU-only inventory was used for any side flagged as clipped or not parsed. Verify every item against the PDF.");
 console.log("[dqm-cu-ai-fallback]",JSON.stringify(fallbackReport.diagnostics));
 return json(fallbackReport,200,o);
});