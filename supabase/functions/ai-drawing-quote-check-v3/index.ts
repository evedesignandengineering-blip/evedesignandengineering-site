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
 const drawingNumber=pick([/(?:DRAWING|DRAWING\s+NO\.?|DWG\.?|DRG\.?)\s*(?:NUMBER|NO\.?|#|ID)?\s*[:#=-]?\s*([A-Z]{0,5}\d{5,8}[A-Z0-9/-]*)/i,/(SP\d{6})/i]);
 const designer=pick([/(?:DESIGNED\s+BY|DRAWN\s+BY|DESIGNER)\s*[:=-]?\s*([^\n|]{2,70})/i]);
 const address=pick([/(?:SITE\s+ADDRESS|PROJECT\s+ADDRESS|WORKS\s+LOCATION|SITE\s+LOCATION|LOCATION)\s*[:=-]?\s*([^\n|]{5,140})/i]);
 const field=(value:string)=>value?{value,confidence:"high"}:undefined;
 const details:any={};if(drawingNumber)details.drawing_number=field(drawingNumber);if(designer)details.designer=field(designer);if(address)details.address=field(address);
 const readCoordinate=(axis:"lat"|"lon"):{value:number;format:string;raw:string}|null=>{
  const label=axis==="lat"?"(?:LATITUDE|LAT)":"(?:LONGITUDE|LONG|LON)";
  const dmsRe=new RegExp("\\b"+label+"\\s*\\.?[^0-9]{0,12}(\\d{1,3})\\s*[°^º]\\s*(\\d{1,2})\\s*['′]\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*['′]{0,2}\\s*([NSEW])","i");
  const dms=text.match(dmsRe);
  if(dms){const degrees=Number(dms[1]),minutes=Number(dms[2]),seconds=Number(dms[3]),hemi=dms[4].toUpperCase();if(minutes<60&&seconds<60){let value=degrees+minutes/60+seconds/3600;if(hemi==="S"||hemi==="W")value=-value;if(Math.abs(value)<=(axis==="lat"?90:180))return {value,format:"degrees-minutes-seconds",raw:dms[0]};}}
  const decimalRe=new RegExp("\\b"+label+"\\s*\\.?\\s*(?:(?:[:=]\\s*)|(?:[-–]\\s+))?([+-]?\\d{1,3}\\.\\d{4,})\\s*([NSEW])?","i");
  const dec=text.match(decimalRe);
  if(dec){let value=Number(dec[1]);const hemi=String(dec[2]||"").toUpperCase();if(hemi==="S"||hemi==="W")value=-Math.abs(value);else if(hemi==="N"||hemi==="E")value=Math.abs(value);if(Math.abs(value)<=(axis==="lat"?90:180))return {value,format:"decimal-degrees",raw:dec[0]};}
  return null;
 };
 const lat=readCoordinate("lat"),lon=readCoordinate("lon");
 const geoReference=lat&&lon?{latitude:lat.value,longitude:lon.value,source:"explicit drawing GEO REF",coordinate_format:lat.format===lon.format?lat.format:"mixed",latitude_text:lat.raw,longitude_text:lon.raw}:null;
 return {project_details:details,geo_reference:geoReference};
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
 const lat=number(geo.latitude??geo.lat),lon=number(geo.longitude??geo.lon??geo.lng);
 const valid=Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat!)<=90&&Math.abs(lon!)<=180;
 const withinWaEnvelope=valid&&lat!>=-35.5&&lat!<=-13&&lon!>=112&&lon!<=129;
 if(valid&&withinWaEnvelope){r.geo_reference={...geo,latitude:lat,longitude:lon};return;}
 const drawingReference=valid?{latitude:lat,longitude:lon,source:geo.source||"coordinate supplied in report",latitude_text:geo.latitude_text,longitude_text:geo.longitude_text}:null;
 const coordinateOutOfWa=valid&&!withinWaEnvelope;
 if(coordinateOutOfWa)r.coordinate_review={status:"DRAWING_COORDINATE_CONFLICT",drawing_reference:drawingReference,message:"The drawing GEO REF is outside the expected Western Australia area. It is retained for review; the checker will use the DQM site address only if that address can be geocoded reliably."};
 const p=r.project_details&&typeof r.project_details==="object"?r.project_details:{};
 const addr=String(p.address?.value??p.address??"").trim();
 if(!addr||addr.length<6){if(coordinateOutOfWa)r.geo_reference={};return;}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const url="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=au&q="+encodeURIComponent(addr);
  const response=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"EVE-Design-Quote-Checker/1.0 (project metadata lookup)","Accept":"application/json"}});
  if(!response.ok){if(coordinateOutOfWa)r.geo_reference={};return;}
  const rows=await response.json(),found=rows?.[0],glat=number(found?.lat),glon=number(found?.lon);
  const geocodedInWa=Number.isFinite(glat)&&Number.isFinite(glon)&&glat!>=-35.5&&glat!<=-13&&glon!>=112&&glon!<=129;
  if(geocodedInWa){
   r.geo_reference={latitude:glat,longitude:glon,source:coordinateOutOfWa?"DQM site-address geocode; drawing GEO REF flagged outside WA bounds":"geocoded drawing site address",matched_address:found.display_name||addr,...(coordinateOutOfWa?{drawing_geo_reference:drawingReference}:{})};
   if(coordinateOutOfWa)r.coordinate_review={status:"DRAWING_COORDINATE_CONFLICT",drawing_reference:drawingReference,routing_coordinates:{latitude:glat,longitude:glon,source:"DQM site-address geocode",matched_address:found.display_name||addr},message:"The drawing's GEO REF is outside the expected Western Australia area and does not agree with the WA job location. Depot routing uses the geocoded DQM site address, while the drawing coordinate is retained here for correction."};
  }else if(coordinateOutOfWa){
   r.geo_reference={};
   r.coordinate_review={status:"DRAWING_COORDINATE_CONFLICT",drawing_reference:drawingReference,message:"The drawing GEO REF is outside the expected Western Australia area and the DQM site address could not be geocoded. Depot travel cannot be calculated safely until the project location is corrected."};
  }else if(!valid&&Number.isFinite(glat)&&Number.isFinite(glon)&&Math.abs(glat!)<=90&&Math.abs(glon!)<=180)r.geo_reference={latitude:glat,longitude:glon,source:"geocoded drawing site address",matched_address:found.display_name||addr};
 }catch{if(coordinateOutOfWa)r.geo_reference={};}finally{clearTimeout(timer);}
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
 const matches=Array.from(text.slice(0,Math.max(0,index)).matchAll(/\[PAGE\s+(\d+)(?:[^\]]*)\]/gi));
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
function cuDrawingCoverage(input:string,items:any[],declaredSheets:unknown,selectionWarning:unknown){
 const text=String(input??""),pageRe=/\[PAGE\s+(\d+)(?:[^\]]*)\]/gi,markers=Array.from(text.matchAll(pageRe)),markerCounts=new Map<number,number>();
 for(let i=0;i<markers.length;i++){const page=Number(markers[i][1]),start=markers[i].index??0,end=i+1<markers.length?(markers[i+1].index??text.length):text.length,block=text.slice(start,end);const count=Array.from(block.matchAll(/\bCU\s*:/gi)).filter(m=>!cuIsNonCuLabel(block,m.index??0)).length;if(count>0)markerCounts.set(page,count);}
 const parsedPages=new Set<number>();for(const item of items||[]){const sourcePages=Array.isArray(item?.source_pages)&&item.source_pages.length?item.source_pages:(item?.page!==undefined&&item?.page!==null?[item.page]:[]);for(const v of sourcePages){const page=Number(v);if(Number.isInteger(page)&&page>0)parsedPages.add(page);}}
 const markerPages=Array.from(markerCounts.keys()).sort((a,b)=>a-b),missingPages=markerPages.filter(page=>!parsedPages.has(page),),occurrences=(items||[]).reduce((sum,item)=>sum+Math.max(1,Number(item?.occurrences)||1),0);
 const declared=Number(declaredSheets),hasDeclared=Number.isInteger(declared)&&declared>0,lowForSheetCount=hasDeclared&&declared>=3&&occurrences<declared,ambiguousSelection=Boolean(String(selectionWarning||"").trim()),complete=missingPages.length===0&&!lowForSheetCount&&!ambiguousSelection;
 const reasons=[];if(missingPages.length)reasons.push("Explicit CU callouts were detected on PDF page(s) "+missingPages.join(", ")+" but no parsed CU inventory item was attributed to those pages.");if(lowForSheetCount)reasons.push("Only "+occurrences+" CU occurrence(s) were extracted for "+declared+" declared drawing sheets; this is too few to treat the inventory as complete.");if(ambiguousSelection)reasons.push(String(selectionWarning));
 return {complete,needs_fallback:!complete,declared_sheet_count:hasDeclared?declared:null,page_marker_count:markers.length,pages_with_explicit_cu_markers:markerPages,cu_markers_by_page:Object.fromEntries(markerCounts),parsed_source_pages:Array.from(parsedPages).sort((a,b)=>a-b),pages_with_markers_but_no_parsed_items:missingPages,parsed_unique_cu_count:(items||[]).length,parsed_occurrence_count:occurrences,selection_warning:ambiguousSelection?String(selectionWarning):null,message:complete?"CU inventory passed the sheet/page coverage checks.":reasons.join(" ")};
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
function cuConfusableSubstitution(aValue:unknown,bValue:unknown):any|null {
 const a=cuNorm(aValue),b=cuNorm(bValue);
 if(!a||!b||a===b||a.length!==b.length)return null;
 const groups=[["S","5"],["I","1","L"],["O","0","Q"],["Z","2"],["B","8"],["G","6"]];
 const substitutions:string[]=[];
 for(let i=0;i<a.length;i++){if(a[i]===b[i])continue;const group=groups.find(chars=>chars.includes(a[i])&&chars.includes(b[i]));if(!group)return null;substitutions.push(a[i]+"→"+b[i]);}
 return substitutions.length&&substitutions.length<=2?{substitutions,from:a,to:b}:null;
}
function cuCorrectConfusableDrawingCodes(items:any[],referenceItems:any[]):any[] {
 const refs=new Map<string,any>();
 for(const candidate of referenceItems||[]){const key=cuNorm(candidate?.code);if(key&&!refs.has(key))refs.set(key,candidate);}
 return (items||[]).map(item=>{
  if(!item?.code)return item;
  const original=String(item.code),key=cuNorm(original);
  if(refs.has(key))return item;
  const candidates:Array<{key:string;item:any;match:any}>=[];
  for(const [candidateKey,candidate] of refs.entries()){const match=cuConfusableSubstitution(original,candidate.code);if(match)candidates.push({key:candidateKey,item:candidate,match});}
  if(candidates.length!==1)return item;
  const winner=candidates[0],correction={from:original,to:String(winner.item.code),substitutions:winner.match.substitutions,basis:"unique DQM/source CU code after lookalike-character comparison"};
  const marker="[CODE RECOGNITION: "+correction.from+" corrected to "+correction.to+" ("+correction.substitutions.join(", ")+") using the unique reference CU code]";
  const evidence=(String(item.evidence||"")+" "+marker).trim().slice(0,1400);
  return {...item,code:String(winner.item.code),original_code:item.original_code||original,code_correction:correction,evidence,confidence:"medium"};
 });
}
function cuMergeInventories(primary:any[],supplemental:any[]){
 const out=(primary||[]).map(item=>({...item})),byKey=new Map<string,any>();
 for(const item of out){const key=cuNorm(item?.code);if(key)byKey.set(key,item);}
 for(const item of supplemental||[]){const key=cuNorm(item?.code);if(!key)continue;const existing=byKey.get(key);if(!existing){const copy={...item};out.push(copy);byKey.set(key,copy);continue;}const pageValues=[...(Array.isArray(existing.source_pages)?existing.source_pages:[]),existing.page,...(Array.isArray(item.source_pages)?item.source_pages:[]),item.page].map(Number).filter(n=>Number.isInteger(n)&&n>0);if(pageValues.length)existing.source_pages=Array.from(new Set(pageValues)).sort((a,b)=>a-b);if(Number.isFinite(Number(item.quantity))){existing.quantity=Number(item.quantity);existing.unit=item.unit||existing.unit;existing.occurrences=item.occurrences||existing.occurrences;existing.confidence=item.confidence||"high";existing.quantity_method="explicit-cu-source-parser";}if(item.original_code)existing.original_code=item.original_code;if(item.code_correction){existing.code_correction=item.code_correction;existing.confidence="medium";}if(item.evidence)existing.evidence=item.evidence;}
 return out;
}
function cuFindExplicitCuEvidence(input:string,codeValue:unknown):any|null {
 const text=cuCompact(input),code=String(codeValue??"").trim();
 if(!code)return null;
 const events=Array.from(text.matchAll(/\b(?:NON\s*CU|DCSH)\s*:|\bCU\s*:/gi));
 const starts=events.filter(m=>/\bCU\s*:/i.test(m[0])&&!/^\s*NON\s*CU\s*:/i.test(m[0])&&!/^\s*DCSH\s*:/i.test(m[0])&&!cuIsNonCuLabel(text,m.index??0));
 const escaped=code.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
 const expression=new RegExp("(?<![A-Z0-9])"+escaped+"(?![A-Z0-9])\\s*[x×]\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(km|m|ea|each)?\\b","gi");
 let total=0,occurrences=0,unit="EA",firstEvidence="",sourcePages:number[]=[];
 for(let i=0;i<starts.length;i++){
  const marker=starts[i],start=marker.index??0,next=events.find(e=>(e.index??-1)>start),end=next?(next.index??text.length):text.length,block=text.slice(start,end);
  expression.lastIndex=0;
  for(const m of block.matchAll(expression)){
   const quantity=Number(m[1].replace(/,/g,""));if(!Number.isFinite(quantity))continue;
   total+=quantity;occurrences++;const u=String(m[2]||"EA").toLowerCase();
   if(occurrences===1)unit=u.toUpperCase();else if(unit!==u.toUpperCase())unit="MIXED";
   const page=cuPageAt(text,start+(m.index??0));if(page!==null&&!sourcePages.includes(page))sourcePages.push(page);
   if(!firstEvidence)firstEvidence=("[PAGE "+(page??"?")+"] "+block.slice(Math.max(0,(m.index??0)-55),Math.min(block.length,(m.index??0)+m[0].length+65))).replace(/\s+/g," ").trim().slice(0,600);
  }
 }
 if(!occurrences)return null;
 return {quantity:Math.round(total*1000)/1000,unit,occurrences,source_pages:sourcePages.sort((a,b)=>a-b),page:sourcePages[0]??null,evidence:firstEvidence,source_confirmed:true};
}
function cuAIItems(input:any,drawing:boolean,sourceText=""):any[] {
 const raw=Array.isArray(input)?input:[],filtered:any[]=[];
 for(const item of raw){
  if(!item||!item.code||!Number.isFinite(Number(item.quantity)))continue;
  if(!drawing){filtered.push(item);continue;}
  const ev=String(item.evidence||"");
  // Prefer positive verification against the full source, even if the model's nearby
  // evidence excerpt also includes adjacent NON CU/DCSH text from the same PDF row.
  const found=cuFindExplicitCuEvidence(sourceText,item.code);
  if(found){
   filtered.push({...item,quantity:found.quantity,unit:found.unit||item.unit,page:found.page??item.page,source_pages:found.source_pages,evidence:found.evidence||ev,source_confirmed:true,confidence:"high",quantity_method:"source-cu-callout-validated"});
  }else if(!/\bNON\s*CU\s*:|\bDCSH\s*:/i.test(ev)&&/\bCU\s*:/i.test(ev)){
   filtered.push({...item,source_confirmed:false,confidence:item.confidence||"medium"});
  }
 }
 const map=new Map<string,any>();
 for(const item of filtered){
  const key=cuNorm(item.code);if(!key)continue;
  if(!map.has(key)){
   map.set(key,{...item,code:String(item.code).toUpperCase(),quantity:Number(item.quantity),occurrences:Math.max(1,Number(item.occurrences)||1),row_count:1,confidence:item.confidence||"medium"});
   continue;
  }
  const target=map.get(key);
  if(item.source_confirmed){
   // Source validation returns the aggregate across repeated callouts; don't add that
   // aggregate again if the model emitted one row for each repeated occurrence.
   target.quantity=Number(item.quantity);target.occurrences=Math.max(Number(target.occurrences)||1,Number(item.occurrences)||1);
   target.unit=item.unit||target.unit;target.source_confirmed=true;target.source_pages=Array.from(new Set([...(target.source_pages||[]),...(item.source_pages||[])])).sort((a,b)=>a-b);
   if(item.evidence)target.evidence=item.evidence;target.confidence="high";target.quantity_method="source-cu-callout-validated";
  }else if(!target.source_confirmed){
   target.quantity+=Number(item.quantity);target.occurrences++;target.row_count++;
   if(!target.evidence&&item.evidence)target.evidence=item.evidence;
  }
 }
 return Array.from(map.values());
}
function cuTextMoneyValues(line:string):number[] {
 const values:number[]=[];
 for(const m of line.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)){const n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n))values.push(n);}
 return values;
}
function cuProjectValue(quoteText:string,drawingText:string):{value:number|null;source:string} {
 const re=/(?:total\s+project\s+value|project\s+value|value\s+of\s+works)\D{0,45}\$?\s*([\d,]+(?:\.\d{1,2})?)/i;
 for(const entry of [[quoteText,"explicit project value from DQM quote"],[drawingText,"explicit project value from drawing"]] as [string,string][]){const m=re.exec(entry[0]);if(m){const n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n))return {value:n,source:entry[1]};}}
 const end=quoteText.search(/Cost\s+Breakdown/i),summary=end>=0?quoteText.slice(0,end):quoteText;
 for(const line of summary.split(/\r?\n/)){if(!/(?:^|\|)\s*Total\s*:/i.test(line))continue;const values=cuTextMoneyValues(line);if(values.length)return {value:values[0],source:"DQM quote Total used as project-value proxy because no explicit project value was found"};}
 return {value:null,source:"project value could not be identified"};
}
function cuTotalInternalCost(quoteText:string):number|null {
 // The user-specified AUX_005 basis is the DQM Cost Summary "Total" row, first column = Total Internal Costs.
 // Do not substitute the smaller "Compatible Units" subtotal when the Total row is absent/unreadable.
 const summaryEnd=quoteText.search(/Cost\s+Breakdown/i),summary=summaryEnd>=0?quoteText.slice(0,summaryEnd):quoteText;
 for(const line of summary.split(/\r?\n/)){
  if(!/^\s*Total\s*:/i.test(line))continue;
  const money=cuTextMoneyValues(line);
  if(money.length&&money[0]>0)return money[0];
 }
 return null;
}
function cuCodeItem(report:any,code:string):any|null {
 const key=cuNorm(code),items=Array.isArray(report.quote_items)?report.quote_items:[];
 return items.find((item:any)=>cuNorm(item.code??item.item_code)===key)||null;
}
function cuFindQuotedQuantity(report:any,code:string,quoteText:string):number|null {
 const item=cuCodeItem(report,code),q=number(item?.quantity??item?.qty);if(q!==null)return q;
 const key=cuNorm(code);
 for(const line of cuCompact(quoteText).split(/\r?\n/)){const first=line.split("|")[0].trim().split(/\s+/)[0];if(cuNorm(first)===key){const value=cuQuoteQty(line);if(value!==null)return value;}}
 return null;
}
function cuPipeDiameter(text:string):string|null {
 const value=String(text??"").toUpperCase().replace(/,/g,"");
 if(/\b400\s*HV\b|\b400HV\b/.test(value))return "160";
 if(/\b120\s*[\/-]\s*240\s*MM\b|\b110\s*MM\b/.test(value))return "110";
 if(/\b(?:1\s*[\/-]\s*16\s*[\/-]\s*25|16|25)\s*MM\b|\b63\s*MM\b/.test(value))return "63";
 return null;
}
function cuExplicitPipeSizes(text:string):string[] {
 const found:string[]=[];
 const re=/\b(63|110|160)\s*MM\s*(?:\|\s*)?POLY\s*PIPE\b|\bPOLY\s*PIPE(?:\s*(?:SIZE|DIA(?:METER)?)\s*)?[:=-]?\s*(63|110|160)\s*MM\b/gi;
 for(const m of text.matchAll(re)){const size=String(m[1]||m[2]);if(!found.includes(size))found.push(size);}
 return found;
}
function cuAddSupplementary(report:any,status:string,item:string,expected:number|null,actual:number|null,unit:string,severity:string,confidence:string,detail:string):void {
 if(!Array.isArray(report.discrepancies))report.discrepancies=[];
 const key=cuNorm(item);
 report.discrepancies=report.discrepancies.filter((entry:any)=>!(entry.status===status&&[entry.drawing_item,entry.quote_item].some(value=>cuNorm(value)===key)));
 if(expected!==null&&actual!==null&&Math.abs(expected-actual)<1e-9)return;
 report.discrepancies.push({status,severity,confidence,drawing_item:item,drawing_quantity:expected,drawing_unit:unit,expected_quantity:expected,expected_unit:unit,quote_item:item,quote_quantity:actual,quote_unit:unit,difference:detail});
}
async function cuApplyAuxAndPolypipeChecks(report:any,drawingText:string,quoteText:string):Promise<void> {
 const notes:string[]=[],quoteClean=cuCompact(quoteText),drawingClean=cuCompact(drawingText),lines=quoteClean.split(/\r?\n/);
 const quantity=(code:string)=>cuFindQuotedQuantity(report,code,quoteClean);
 const project=cuProjectValue(quoteClean,drawingClean),a13=quantity("AUX_013");
 if(project.value!==null&&a13!==null){
  const expected=project.value<=50000?1:project.value<=200000?3:12;
  cuAddSupplementary(report,"AUX_013_PROJECT_VALUE_MISMATCH","AUX_013",expected,a13,"EA","high","high","AUX_013 expected "+expected+" for project value $"+project.value.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})+" ("+project.source+"); quote quantity is "+a13+".");
 }else if(a13===null)notes.push("AUX_013 could not be checked because its DQM Compatible Units quantity was not confidently extracted.");
 else cuAddSupplementary(report,"REVIEW_REQUIRED","AUX_013",null,a13,"EA","medium","low","AUX_013 quantity is "+a13+", but the project value could not be identified from the drawing or DQM quote. The project-value rule could not be verified.");
 const cost=cuTotalInternalCost(quoteClean),a5=quantity("AUX_005");
 if(cost!==null&&a5!==null){
  const adjusted=cost-174.13*a5,expected=adjusted<=0?0:4*Math.ceil(adjusted/10000);
  if(a5!==expected){
   const expAmount=expected*174.13,actAmount=a5*174.13;
   cuAddSupplementary(report,"AUX_005_INTERNAL_COST_MISMATCH","AUX_005",expected,a5,"EA","high","high","Total internal cost is $"+cost.toLocaleString("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2})+". Subtract quoted AUX_005 allowance ("+a5+" × $174.13 = $"+actAmount.toFixed(2)+") to get adjusted cost $"+adjusted.toFixed(2)+". Expected AUX_005 is 4 × ceil(adjusted cost / $10,000) = "+expected+" units ($"+expAmount.toFixed(2)+"); quote has "+a5+" units ($"+actAmount.toFixed(2)+").");
  }else report.discrepancies=report.discrepancies.filter((entry:any)=>!(entry.status==="AUX_005_INTERNAL_COST_MISMATCH"&&cuNorm(entry.quote_item)==="AUX005"));
 }else if(a5!==null){
  cuAddSupplementary(report,"AUX_005_INTERNAL_COST_MISMATCH","AUX_005",null,a5,"EA","medium","low","AUX_005 is quoted at "+a5+" units, but the DQM Cost Summary Total (first-column Total Internal Costs) could not be reliably extracted. No expected quantity was assumed; manual verification is required.");
  notes.push("AUX_005 calculation needs manual review because the DQM Cost Summary Total Internal Costs value was not readable.");
 }
 const cn54Items=(Array.isArray(report.drawing_items)?report.drawing_items:[]).filter((item:any)=>/^CN54(?:_|[A-Z0-9]|$)/i.test(String(item.code??"")));
 const cn54Qty=cn54Items.reduce((sum:number,item:any)=>sum+(number(item.quantity??item.qty)||0),0);
 if(cn54Items.length){
  const expected=cn54Qty*2,actual=quantity("CABLE_07");
  if(actual===null)cuAddSupplementary(report,"CN54X_CABLE_07X_MISMATCH","CABLE_07",expected,null,"EA","high","medium","Drawing CN54x quantities total "+cn54Qty+"; CABLE_07 must be twice that quantity ("+expected+"), but the DQM CABLE_07 quantity was not confidently read.");
  else cuAddSupplementary(report,"CN54X_CABLE_07X_MISMATCH","CABLE_07",expected,actual,"EA","high","high","Each drawing CN54x unit requires 2 CABLE_07 units. Drawing CN54x total: "+cn54Qty+"; expected CABLE_07: "+expected+"; quote CABLE_07: "+actual+".");
 }
 // Cable-to-polypipe mapping: 1/16/25 mm -> 63 mm; 120/240 mm -> 110 mm; 400 HV -> 160 mm.
 const drillRows=lines.filter(line=>/(?:DDRILL|DIRECTIONAL\s*DRILL|D.?DRILL)/i.test(line)&&cuQuoteQty(line)!==null);
 const knownDrillCodes=new Set(drillRows.map(line=>(line.match(/^\s*((?:DDRILL|DIRECTIONAL\s*DRILL|D.?DRILL)[A-Z0-9_./-]*)/i)?.[1]||"").toUpperCase()).filter(Boolean));
 for(const item of (Array.isArray(report.quote_items)?report.quote_items:[])){
  const code=String(item.code??item.item_code??"").trim();
  if(!/^(?:DDRILL|DIRECTIONAL\s*DRILL|D.?DRILL)/i.test(code)||knownDrillCodes.has(code.toUpperCase()))continue;
  const q=number(item.quantity??item.qty);if(q===null)continue;
  drillRows.push(code+" "+String(item.description||"")+" N "+q);knownDrillCodes.add(code.toUpperCase());
 }
 const pipeSizes=cuExplicitPipeSizes(drawingClean),checkedSizes=new Set<string>();
 for(const line of drillRows){
  const expectedSize=cuPipeDiameter(line);if(!expectedSize||checkedSizes.has(expectedSize))continue;checkedSizes.add(expectedSize);
  if(pipeSizes.length&&!pipeSizes.includes(expectedSize)){
   const actual=pipeSizes.length===1?Number(pipeSizes[0]):null;
   cuAddSupplementary(report,"POLYPIPE_SIZE_MISMATCH","Required polypipe "+expectedSize+"mm",Number(expectedSize),actual,"mm","high","high","DQM drilling CU indicates cable class '"+line.trim().slice(0,160)+"', which maps to "+expectedSize+"mm polypipe. Explicit drawing polypipe callout(s) found: "+pipeSizes.join(", ")+"mm. Confirm the correct diameter is shown for this drill run.");
  }else if(!pipeSizes.length)cuAddSupplementary(report,"REVIEW_REQUIRED","Polypipe "+expectedSize+"mm",Number(expectedSize),null,"mm","medium","low","DQM drilling CU indicates a cable class that maps to "+expectedSize+"mm polypipe, but no explicit diameter-labelled polypipe callout could be extracted from the drawing. Verify the plan or detail.");
 }
 // DDrill installation and haul must match by polypipe diameter, not by cable run length.
 const haulRows=lines.filter(line=>/\bHAUL\b/i.test(line)&&cuQuoteQty(line)!==null);
 const drills=drillRows.map(line=>{
  const code=(line.match(/^\s*((?:DDRILL|DIRECTIONAL\s*DRILL|D.?DRILL)[A-Z0-9_./-]*)/i)?.[1]||"DDRILL").toUpperCase();
  const fallback=cuCodeItem(report,code);
  return {code,quantity:cuQuoteQty(line)??number(fallback?.quantity??fallback?.qty),diameter:cuPipeDiameter(line)};
 }).filter(record=>record.quantity!==null);
 const drillTotals=new Map<string,{quantity:number;codes:string[]}>();
 for(const drill of drills){
  if(!drill.diameter)continue;
  const current=drillTotals.get(drill.diameter)||{quantity:0,codes:[]};
  current.quantity+=Number(drill.quantity);if(!current.codes.includes(drill.code))current.codes.push(drill.code);
  drillTotals.set(drill.diameter,current);
 }
 for(const [diameter,installation] of drillTotals){
  const haul=haulRows.map(line=>({quantity:cuQuoteQty(line),diameter:cuPipeDiameter(line)})).filter(item=>item.diameter===diameter&&item.quantity!==null);
  const installQty=installation.quantity,label="DDrill/haul "+diameter+"mm";
  if(!haul.length){cuAddSupplementary(report,"REVIEW_REQUIRED",label,installQty,null,"m","medium","medium","DQM includes "+installation.codes.join(", ")+" for the "+diameter+"mm polypipe class, but no matching haul row for that diameter was confidently identified. Verify that the haul quantity is present and equals the combined installation quantity ("+installQty+").");continue;}
  const haulQty=haul.reduce((sum:number,item:any)=>sum+Number(item.quantity),0);
  cuAddSupplementary(report,"DRILL_HAUL_QUANTITY_MISMATCH",label,installQty,haulQty,"m","high","high","DDrill installation and haul quantities must match for "+diameter+"mm polypipe. Combined installation rows total "+installQty+" m; matching haul rows total "+haulQty+" m.");
 }
 const checks={
  project_value:{value:project.value,source:project.source,status:project.value===null?"NEEDS_REVIEW":a13===null?"NEEDS_REVIEW":(project.value<=50000?1:project.value<=200000?3:12)===a13?"PASS":"MISMATCH"},
  aux_005:{internal_cost:cost,total_internal_cost:cost,cost_source:"DQM Cost Summary Total row, first-column Total Internal Costs",quoted_quantity:a5,aux005_allowance_deducted:cost!==null&&a5!==null?Math.round(174.13*a5*100)/100:null,adjusted_total_internal_cost:cost!==null&&a5!==null?Math.round((cost-174.13*a5)*100)/100:null,formula:"Expected AUX_005 = 4 × ceil((DQM Total Internal Costs − quoted AUX_005 quantity × $174.13) / $10,000), minimum 0",expected_quantity:cost!==null&&a5!==null?(cost-174.13*a5<=0?0:4*Math.ceil((cost-174.13*a5)/10000)):null,status:cost===null||a5===null?"NEEDS_REVIEW":(cost-174.13*a5<=0?0:4*Math.ceil((cost-174.13*a5)/10000))===a5?"PASS":"MISMATCH"},
  cn54_cable_07:{drawing_cn54_quantity:cn54Qty,quoted_cable_07_quantity:quantity("CABLE_07"),expected_cable_07_quantity:cn54Qty*2,status:!cn54Items.length?"NOT_APPLICABLE":quantity("CABLE_07")===cn54Qty*2?"PASS":"MISMATCH"},
  polypipe:{drawing_callout_sizes_mm:pipeSizes,drilling_size_classes_checked:Array.from(checkedSizes)},
  drill_haul:{drilling_rows:drills.length,haul_rows:haulRows.length}
 };
 report.supplementary_checks=checks;
 report.diagnostics={...(report.diagnostics||{}),supplementary_checks:checks};
 if(notes.length){if(!Array.isArray(report.limitations))report.limitations=[];report.limitations.push(...notes);}
 const extra=report.discrepancies.filter((entry:any)=>/^AUX_|^(?:POLYPIPE_SIZE_MISMATCH|DRILL_HAUL_QUANTITY_MISMATCH|CN54X_CABLE_07X_MISMATCH)$/.test(String(entry.status)));
 if(extra.length)report.summary+=" Supplementary checks flagged "+extra.length+" AUX/cable/polypipe item(s) for review.";
}

async function cuCalculateDepotTravel(report:any,drawingText:string,quoteText:string):Promise<void> {
 const derived=extractProjectMetadata(drawingText);
 if(!report.project_details||typeof report.project_details!=="object")report.project_details={};
 for(const key of ["drawing_number","designer"]){if(derived.project_details?.[key]&&!report.project_details[key])report.project_details[key]=derived.project_details[key];}
 const headerField=(label:RegExp):string=>{
  for(const rawLine of quoteText.split(/\r?\n/)){const parts=rawLine.split("|").map(part=>part.trim());for(let i=0;i<parts.length;i++){const match=parts[i].match(label);if(!match)continue;const inline=String(match[1]||"").replace(/\*+/g,"").trim();if(inline&&!/^(?:Quote Version|Option|Issue Date|Approval|Design Office|Construction Branch|Work Driver|Underlying Cause)\s*:/i.test(inline))return inline;for(let j=i+1;j<parts.length;j++){const candidate=parts[j].replace(/\*+/g,"").trim();if(!candidate||/^(?:Quote Version|Option|Issue Date|Approval|Design Office|Construction Branch|Work Driver|Underlying Cause)\s*:/i.test(candidate))break;return candidate;}}}
  return "";
 };
 const title=headerField(/^\s*Job\s+Title\s*:\s*(.*)$/i).replace(/\s+/g," ").trim(),quoteAddress=headerField(/^\s*Address\s*:\s*(.*)$/i).replace(/\s+/g," ").trim();
 const titleLooksLikeAddress=/\b\d+\s+.+\b(?:ST|STREET|RD|ROAD|DR|DRIVE|AVE|AVENUE|HWY|HIGHWAY|CT|COURT|CRES|CRESCENT|WAY|LN|LANE)\b/i.test(title);
 const existingAddress=String(report.project_details.address?.value??report.project_details.address??"").trim(),isDrawingLabel=/\b(?:LOCATION\s+PLAN|SITE\s+PLAN|AREA\s+PLAN|KEY\s+PLAN)\b/i.test(existingAddress);
 const selectedAddress=titleLooksLikeAddress?title:quoteAddress||title,preferredAddress=selectedAddress?selectedAddress+(/\bWA\b/i.test(selectedAddress)?"":", WA"):"";
 if((!existingAddress||isDrawingLabel)&&preferredAddress)report.project_details.address={value:preferredAddress,confidence:"high",source:"DQM quote job title/address"};
 else if(!report.project_details.address&&preferredAddress)report.project_details.address={value:preferredAddress,confidence:"medium",source:"DQM quote job title/address"};
 if(derived.geo_reference)report.geo_reference=derived.geo_reference;
 else if(!report.geo_reference||typeof report.geo_reference!=="object")report.geo_reference={};
 await ensureDepotCoordinates(report,drawingText);
 const geo=report.geo_reference||{},lat=number(geo.latitude??geo.lat),lon=number(geo.longitude??geo.lon??geo.lng);
 const travelItems=(Array.isArray(report.quote_items)?report.quote_items:[]).filter((item:any)=>/\bTRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+\b/i.test(String(item.code??item.item_code??""))&&Number.isFinite(number(item.quantity??item.qty)));
 const makeUncalculatedItems=(status:string)=>travelItems.map((item:any)=>({code:String(item.code??item.item_code),description:String(item.description||""),quoted_quantity:number(item.quantity??item.qty),expected_quantity:null,unit:"km",factor:null,road_distance_km:null,difference_km:null,status,message:report.coordinate_review?.message||"A reliable one-way driving route is not available; expected travel has not been guessed."}));
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat!)>90||Math.abs(lon!)>180){
  report.depot_travel={depot_name:"Not determined",depot:"Not determined",distance_km:null,source:"reliable WA site coordinates unavailable",project_latitude:null,project_longitude:null};
  const coordinateMessage=report.coordinate_review?.message;
  report.travel_allowance_check={status:"NEEDS_LOCATION",travel_items_found:travelItems.length,items:makeUncalculatedItems("NEEDS_LOCATION"),message:coordinateMessage||"Could not establish reliable project coordinates from the drawing GEO REF or DQM site address; no straight-line distance has been substituted."};
  if(!Array.isArray(report.limitations))report.limitations=[];
  report.limitations.push(coordinateMessage||"Depot travel could not be calculated because a reliable project location could not be established.");return;
 }
 const depots:[string,number,number][]=[
  ["Forrestdale",-32.136882,115.951940],["Rural Northam",-31.652603,116.697103],["Kalgoorlie",-30.787083,121.422549],
  ["Vasse",-33.676915,115.234244],["Albany",-34.999186,117.866192],["Bridgetown",-33.954527,116.126206],
  ["Picton",-33.352394,115.698416],["Katanning",-33.700739,117.530560],["Narrogin",-32.952570,117.190875],
  ["Kondinin",-32.457851,118.265403],["Merredin",-31.491310,118.241399],["Geraldton",-28.768415,114.647471],
  ["Jurien Bay",-30.297442,115.050616],["Moora",-30.630986,116.029825]
 ];
 const radians=(n:number)=>n*Math.PI/180,haversine=(a:number,b:number,c:number,d:number)=>{const x=radians(c-a),y=radians(d-b),v=Math.sin(x/2)**2+Math.cos(radians(a))*Math.cos(radians(c))*Math.sin(y/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
 const nearest=depots.map(d=>({d,straight:haversine(lat!,lon!,d[1],d[2])})).sort((a,b)=>a.straight-b.straight).slice(0,3);
 const routes=await Promise.all(nearest.map(async x=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);try{const url="https://router.project-osrm.org/route/v1/driving/"+lon+","+lat+";"+x.d[2]+","+x.d[1]+"?overview=false",response=await fetch(url,{signal:controller.signal});if(!response.ok)return null;const data=await response.json(),metres=data.routes?.[0]?.distance;return typeof metres==="number"?{name:x.d[0],latitude:x.d[1],longitude:x.d[2],straight_line_distance_km:x.straight,distance_km:metres/1000}:null;}catch{return null;}finally{clearTimeout(timer);}}));
 const routed=routes.filter(Boolean).sort((a:any,b:any)=>a.distance_km-b.distance_km)[0] as any;
 if(!routed){
  const nearestDepot=nearest[0];
  report.depot_travel={depot_name:nearestDepot.d[0],depot:nearestDepot.d[0],distance_km:null,straight_line_distance_km:Math.round(nearestDepot.straight*10)/10,depot_latitude:nearestDepot.d[1],depot_longitude:nearestDepot.d[2],source:"nearest supplied depot coordinate; driving route unavailable",project_latitude:lat,project_longitude:lon,project_coordinate_source:geo.source||"drawing/quote coordinates"};
  report.travel_allowance_check={status:"NEEDS_ROUTE",travel_items_found:travelItems.length,items:makeUncalculatedItems("NEEDS_ROUTE"),nearest_depot:nearestDepot.d[0],nearest_straight_line_distance_km:Math.round(nearestDepot.straight*10)/10,message:"The nearest supplied depot by coordinates is "+nearestDepot.d[0]+" ("+Math.round(nearestDepot.straight*10)/10+" km straight-line), but the driving-route service did not return a road distance. No straight-line distance has been used to calculate travel quantities."};
  if(!Array.isArray(report.limitations))report.limitations=[];
  report.limitations.push("The nearest depot coordinate was identified, but its driving distance was unavailable; travel quantities are shown as not calculated instead of being guessed.");return;
 }
 const roadKm=routed.distance_km,roundedRoadKm=Math.round(roadKm*10)/10;
 report.depot_travel={depot_name:routed.name,depot:routed.name,distance_km:roundedRoadKm,unrounded_distance_km:roadKm,straight_line_distance_km:Math.round(routed.straight_line_distance_km*10)/10,depot_latitude:routed.latitude,depot_longitude:routed.longitude,source:"OSRM driving route between supplied depot coordinates and project coordinates",project_latitude:lat,project_longitude:lon,project_coordinate_source:geo.source||"drawing/quote coordinates",matched_address:geo.matched_address||null,nearest_depot_candidates:routes.map((r:any)=>({depot:r.name,distance_km:Math.round(r.distance_km*10)/10,straight_line_distance_km:Math.round(r.straight_line_distance_km*10)/10})).sort((a:any,b:any)=>a.distance_km-b.distance_km)};
 const comparisonItems:any[]=[];let mismatchCount=0,matchCount=0;
 for(const item of travelItems){
  const code=String(item.code??item.item_code),quantity=number(item.quantity??item.qty);if(quantity===null)continue;
  const switching=/\bTRAV(?:EL)?\s*OH[_\s-]*0*007\b/i.test(code)||/switch(?:ing)?\s*crew/i.test(String(item.description||""));
  const factor=switching?6:2,expected=Math.round(roadKm*factor),difference=Math.abs(quantity-expected),tolerance=switching?15:5,status=difference<tolerance?"MATCH":"MISMATCH";
  if(status==="MATCH")matchCount++;else mismatchCount++;
  comparisonItems.push({code,description:String(item.description||""),quoted_quantity:quantity,expected_quantity:expected,unit:"km",factor,road_distance_km:roundedRoadKm,difference_km:Math.round(difference*10)/10,tolerance_km:tolerance,status,formula:roundedRoadKm+" km one-way road distance × "+factor+" = "+expected+" km expected"});
  if(status==="MATCH")continue;
  report.discrepancies.push({status:"DEPOT_TRAVEL_MISMATCH",severity:"high",confidence:"high",drawing_item:"Depot travel allowance",drawing_quantity:expected,drawing_unit:"km",expected_quantity:expected,expected_unit:"km",quote_item:code,quote_quantity:quantity,quote_unit:"km",difference:"Quoted travel allowance differs from the nearest depot driving distance. "+routed.name+" road route: "+roundedRoadKm+" km × "+factor+" = "+expected+" km expected; quote has "+quantity+" km (difference "+Math.round(difference*10)/10+" km; tolerance "+tolerance+" km)."});
 }
 report.travel_allowance_check={status:"CHECKED",travel_items_found:travelItems.length,road_distance_km:roundedRoadKm,nearest_depot:routed.name,straight_line_distance_km:Math.round(routed.straight_line_distance_km*10)/10,formula:"Standard OH/UG travel = one-way road km × 2; switching crew travel = one-way road km × 2 × 3 (× 6); expected quantities rounded to whole km.",items:comparisonItems,mismatches:mismatchCount,matches:matchCount,message:travelItems.length?(mismatchCount?mismatchCount+" of "+travelItems.length+" travel allowance(s) differ from calculated driving-distance allowances.":"All "+travelItems.length+" travel allowance(s) are within the existing tolerance."):"A nearest depot and driving distance were calculated, but no travel CU rows were confidently extracted from the DQM Compatible Units table."};
 if(Array.isArray(report.ignored_quote_extras))report.ignored_quote_extras=report.ignored_quote_extras.filter((x:any)=>!/\bTRAV(?:EL)?\s*(?:OH|UG)[_\s-]*0*\d+\b/i.test(String(x.item||"")));
 if(mismatchCount)report.summary+=" Depot travel check: "+mismatchCount+" allowance mismatch(es) based on "+roundedRoadKm+" km road distance from "+routed.name+".";
}
function cuCompare(drawingItems:any[],quoteItems:any[],meta:any={}):any {
 const quoteMap=new Map<string,any>(quoteItems.map((item:any)=>[cuNorm(item.code),item] as [string,any])),drawingKeys=new Set<string>(drawingItems.map((item:any)=>cuNorm(item.code)));
 const discrepancies:any[]=[],matched:any[]=[],used=new Set<string>();
 for(const d of drawingItems){
  const resolved=cuResolve(d,quoteMap,drawingKeys),q=resolved?quoteMap.get(resolved.key):null;
   const correctionNote=d.code_correction?" OCR code correction: "+d.code_correction.from+" → "+d.code_correction.to+" ("+d.code_correction.substitutions.join(", ")+"); visually confirm.":"";
  if(!q){discrepancies.push({status:"MISSING_FROM_QUOTE",severity:"high",confidence:d.confidence||"high",drawing_item:d.code,drawing_quantity:d.quantity,drawing_unit:d.unit||"EA",expected_quantity:d.quantity,expected_unit:d.unit||"EA",quote_item:null,quote_quantity:null,quote_unit:d.unit||"EA",difference:d.code+" is explicitly listed in the drawing CU callout(s) but is not present in the DQM Compatible Units table."});continue;}
  used.add(resolved.key);const expected=Number(d.quantity),actual=Number(q.quantity),unit=d.unit||"EA";
  if(Math.abs(expected-actual)>1e-9)discrepancies.push({status:"QUANTITY_MISMATCH",severity:"high",confidence:resolved.confidence,drawing_item:d.code,drawing_quantity:expected,drawing_unit:unit,expected_quantity:expected,expected_unit:unit,quote_item:q.code,quote_quantity:actual,quote_unit:q.unit||unit,difference:"Drawing CU callout(s) total "+expected+" "+unit+" across "+(d.occurrences||1)+" occurrence(s); DQM Compatible Units rows total "+actual+" across "+(q.row_count||1)+" row(s). "+resolved.note+correctionNote});
  else matched.push({drawing_item:d.code,drawing_quantity:expected,quote_item:q.code,quote_quantity:actual,note:resolved.note+correctionNote,confidence:d.code_correction?"medium":resolved.confidence});
 }
 const extras=quoteItems.filter(item=>!used.has(cuNorm(item.code))).map(item=>({item:item.code,quantity:item.quantity,reason:"Quote-only Compatible Unit not listed in drawing CU callouts; ignored as requested."}));
 const missing=discrepancies.filter(x=>x.status==="MISSING_FROM_QUOTE").length,qty=discrepancies.filter(x=>x.status==="QUANTITY_MISMATCH").length;
 return {summary:discrepancies.length?"CU-only comparison complete: "+drawingItems.length+" unique drawing CU codes; "+matched.length+" quantities match; "+qty+" quantity mismatch(es); "+missing+" drawing CU code(s) missing from the DQM Compatible Units table. Quote-only CUs are ignored as discrepancies.":"CU-only comparison complete: all "+drawingItems.length+" unique drawing CU codes match the DQM Compatible Units table by quantity. Quote-only CUs are ignored as discrepancies.",comparison_scope:"CU-only: drawing CU callouts compared against DQM Compatible Units; NON CU and DCSH notes excluded.",drawing_items:drawingItems.map(item=>({...item,source_page:item.page,unit:item.unit||"EA"})),quote_items:quoteItems.map(item=>({...item,source_page:item.page})),discrepancies,matched_items:matched,ignored_quote_extras:extras,limitations:["Only explicit entries under drawing CU: callouts are counted. NON CU and DCSH note blocks are excluded.","Repeated code quantities are totalled across drawing CU callouts and repeated DQM Compatible Units rows.","Known abbreviated/variant codes are matched only by explicit rules or a unique quote-code prefix; ambiguous matches are flagged missing for review.","Verify final CU quantities and code variants against the original PDFs before quote acceptance."],human_review_required:true,ai_powered:false,diagnostics:{mode:"deterministic-cu-reconciliation",drawing_cu_unique_count:drawingItems.length,quote_cu_unique_count:quoteItems.length,matched_count:matched.length,discrepancy_count:discrepancies.length,drawing_cu_occurrences:drawingItems.reduce((n,item)=>n+(item.occurrences||1),0),quote_rows_aggregated:quoteItems.reduce((n,item)=>n+(item.row_count||1),0),...meta},note:"Quantities are reconciled from explicit drawing CU callouts and the DQM Compatible Units table. Verify any reported difference against the source PDFs before approval."};
}

Deno.serve(async(req:Request)=>{
 const o=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:cors(o)});if(o&&!ORIGINS.includes(o))return json({error:"Origin not allowed."},403,o);if(req.method!=="POST")return json({error:"Use POST."},405,o);if(!allowed(req))return json({error:"Rate limit reached. Wait one minute before retrying."},429,o);
 const key=Deno.env.get("GEMINI_API_KEY"),nvidiaKey=Deno.env.get("NVIDIA_API_KEY");
 let b:any;try{b=await req.json();}catch{return json({error:"Expected JSON request body."},400,o);}const dt=clean(b.drawingText),qt=clean(b.quoteText),scope=clean(b.scope,8000),di=Array.isArray(b.drawingImages)?b.drawingImages.slice(0,9):[],qi=Array.isArray(b.quoteImages)?b.quoteImages.slice(0,5):[];
 if(!dt.trim()&&!di.length)return json({error:"No readable drawing text or page images were provided."},400,o);if(!qt.trim()&&!qi.length)return json({error:"No readable quote text or page images were provided."},400,o);
 const parsedDrawingCu=cuExtractDrawingItems(dt),parsedQuoteCu=cuExtractQuoteItems(qt),drawingCoverage=cuDrawingCoverage(dt,parsedDrawingCu,b.declaredDrawingSheets,b.drawingSheetSelectionWarning);
 if(parsedDrawingCu.length&&parsedQuoteCu.length&&!b.drawingTextTruncated&&!b.quoteTextTruncated&&!drawingCoverage.needs_fallback){
  const correctedParsedDrawingCu=cuCorrectConfusableDrawingCodes(parsedDrawingCu,parsedQuoteCu),directCodeCorrections=correctedParsedDrawingCu.filter(item=>item.code_correction).map(item=>item.code_correction);
  const directReport=cuCompare(correctedParsedDrawingCu,parsedQuoteCu,{model:"deterministic-cu-reconciliation",ai_attempted_models:0,code_corrections:directCodeCorrections,drawing_text_length:dt.length,quote_text_length:qt.length,declared_drawing_sheets:b.declaredDrawingSheets??null,frontend_extracted_drawing_chars:b.drawingTextChars??dt.length,frontend_extracted_quote_chars:b.quoteTextChars??qt.length,drawing_pages:b.drawingPages??null,source_drawing_pages:b.sourceDrawingPages??null,drawing_text_truncated:!!b.drawingTextTruncated,quote_text_truncated:!!b.quoteTextTruncated,drawing_truncated_pages:b.drawingTruncatedPages??0,quote_truncated_pages:b.quoteTruncatedPages??0,drawing_cu_coverage:drawingCoverage,drawing_sheet_map:b.drawingSheetMap??null});
  directReport.ai_powered=false;directReport.cu_inventory_complete=true;
  await cuCalculateDepotTravel(directReport,dt,qt);
  await cuApplyAuxAndPolypipeChecks(directReport,dt,qt);
  directReport.diagnostics={...(directReport.diagnostics||{}),depot_travel:directReport.depot_travel,travel_allowance_check:directReport.travel_allowance_check,coordinate_review:directReport.coordinate_review,supplementary_checks:directReport.supplementary_checks};
  if(directCodeCorrections.length)directReport.limitations.unshift("One or more drawing CU codes were conservatively corrected for OCR lookalike characters using a unique DQM CU code. Original and corrected codes are shown in the drawing evidence; verify them visually before approval.");
  directReport.summary+=" Deterministic extraction was complete, so Gemini was not needed for the CU comparison.";
  console.log("[dqm-cu-deterministic-success]",JSON.stringify(directReport.diagnostics));
  return json(directReport,200,o);
 }
 if(!key&&!nvidiaKey)return json({error:"The PDF text extraction was not sufficiently complete for a full CU comparison, and Gemini fallback is not configured. No full comparison was generated.",diagnostic:{drawing_cu_items_found:parsedDrawingCu.length,quote_cu_items_found:parsedQuoteCu.length,drawing_text_length:dt.length,quote_text_length:qt.length,drawing_cu_coverage:drawingCoverage,drawing_sheet_map:b.drawingSheetMap??null}},422,o);
 const imgs=(a:unknown[])=>a.map((v:any)=>{const m=String(v||"").match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);return !m||m[2].length>1600000?null:{inlineData:{mimeType:m[1]==="jpg"?"image/jpeg":"image/"+m[1],data:m[2]}};}).filter(Boolean);
 const parts:any[]=[{text:"DRAWING TEXT (untrusted document):\n"+(dt||"[No text layer]")},...imgs(di),{text:"QUOTE TEXT (untrusted document):\n"+(qt||"[No text layer]")},...imgs(qi),{text:"USER SCOPE:\n"+(scope||"[None]")}];
 const instructions='Only compare compatible units (CU) between the electrical drawing and DQM quote. Recognize catalogue codes carefully: S/5, I/1/L, O/0/Q, Z/2, B/8 and G/6 can be visually confused by OCR. Prefer exact source codes and unique reference matches; never silently guess when multiple alternatives exist. Read every [PAGE n] block and every numbered drawing sheet; do not stop after the first sheets and do not assume that the first N physical PDF pages equal Sheet 1 of N through Sheet N of N. On drawings, count quantities only inside explicit "CU:" callouts. Exclude "NON CU:" and "DCSH:" sections and never count codes elsewhere. In the DQM quote, read quantities only from the "Compatible Units" table; the quantity is the number after the standalone O-column letter N. Sum repeated drawing callouts and repeated quote rows. Ignore quote-only extras as discrepancies. Preserve the physical PDF page number in evidence/page, and state any sheet that could not be read in limitations. Do not invent quantities. Return strict JSON with drawing_items and quote_items arrays, each item containing code, quantity, evidence, page and confidence, plus summary and limitations.';
 // Quota-aware order from current AI Studio limits: prioritize Flash-Lite models with remaining daily quota; skip Gemini 3 Flash/3.6/3.8 while their RPD caps are exceeded; skip Gemma 4 26B while TPM is exceeded.
 const batches=[["gemini-3.5-flash-lite","gemini-3.1-flash-lite"],["gemini-2.5-flash-lite"],["gemini-2.5-flash"],["gemma-4-31b-it"]],start=Date.now();
 let selected="",result:any=null,raw="",finishReason="UNKNOWN";const statuses:number[]=[];let tried=0;
 async function callGemini(model:string){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),23000);
  try{
   const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{method:"POST",headers:{"x-goog-api-key":key||"","Content-Type":"application/json"},signal:c.signal,body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:"user",parts}],generationConfig:{temperature:0,maxOutputTokens:6500,responseMimeType:"application/json",thinkingConfig:{thinkingLevel:model.startsWith("gemma-4-")?"minimal":"low"}}})});
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
  if(result||Date.now()-start>100000)break;
  tried+=batch.length;
  console.log("[dqm-model-batch-start]",batch.join(","));
  const outcomes=await Promise.allSettled(batch.map(model=>callGemini(model)));
  const success=outcomes.find((x:any)=>x.status==="fulfilled") as PromiseFulfilledResult<any>|undefined;
  if(success){result=success.value.obj;raw=success.value.textOut;selected=success.value.model;finishReason=success.value.reason;console.log("[dqm-model-batch-success]",selected);}
  else console.error("[dqm-model-batch-failed]",batch.join(","));
 }
 if(!result)return json({error:"The CU tables could not be read reliably from both PDFs. No quantity comparison was generated, to avoid false discrepancies.",attempted_models:tried,diagnostic:{drawing_cu_items_found:parsedDrawingCu.length,quote_cu_items_found:parsedQuoteCu.length,drawing_cu_coverage:drawingCoverage,drawing_sheet_map:b.drawingSheetMap??null,finishReason,elapsed_ms:Date.now()-start,provider_statuses:statuses,model_batches:batches,maximum_fallback_window_ms:100000}},422,o);
 const aiDrawingItems=cuAIItems(result.drawing_items,true,dt),aiQuoteItems=cuAIItems(result.quote_items,false);
  const drawingNeedsAI=!!b.drawingTextTruncated||drawingCoverage.needs_fallback||!!b.drawingSheetSelectionWarning;
  const referenceDrawingCodes=cuCorrectConfusableDrawingCodes(parsedDrawingCu,parsedQuoteCu);
  const aiDrawingCorrected=cuCorrectConfusableDrawingCodes(aiDrawingItems,parsedQuoteCu.length?parsedQuoteCu:aiQuoteItems);
  const aiDrawingCu=drawingNeedsAI?cuMergeInventories(aiDrawingCorrected,referenceDrawingCodes):(referenceDrawingCodes.length?referenceDrawingCodes:aiDrawingCorrected);
  const fallbackCodeCorrections=aiDrawingCu.filter(item=>item.code_correction).map(item=>item.code_correction);
 const aiQuoteCu=b.quoteTextTruncated?aiQuoteItems:(parsedQuoteCu.length?parsedQuoteCu:aiQuoteItems);
 if(!aiDrawingCu.length||!aiQuoteCu.length)return json({error:"Gemini returned a response, but one CU inventory was not sufficiently evidenced. No quantity comparison was generated.",diagnostic:{drawing_cu_items_found:aiDrawingCu.length,quote_cu_items_found:aiQuoteCu.length,drawing_cu_coverage:drawingCoverage,drawing_sheet_map:b.drawingSheetMap??null,model:selected,finishReason,provider_statuses:statuses}},422,o);
 const finalDrawingCoverage=cuDrawingCoverage(dt,aiDrawingCu,b.declaredDrawingSheets,b.drawingSheetSelectionWarning);
 const fallbackReport=cuCompare(aiDrawingCu,aiQuoteCu,{model:selected,ai_fallback_used:true,ai_attempted_models:tried,model_elapsed_ms:Date.now()-start,drawing_text_length:dt.length,quote_text_length:qt.length,drawing_pages:b.drawingPages??null,source_drawing_pages:b.sourceDrawingPages??null,declared_drawing_sheets:b.declaredDrawingSheets??null,drawing_cu_coverage:finalDrawingCoverage,drawing_sheet_map:b.drawingSheetMap??null,code_corrections:fallbackCodeCorrections});
 fallbackReport.ai_powered=true;fallbackReport.cu_inventory_complete=finalDrawingCoverage.complete;
 if(!finalDrawingCoverage.complete){fallbackReport.review_status="INCOMPLETE_DRAWING_CU_INVENTORY";fallbackReport.summary="WARNING: the drawing CU inventory could not be verified as complete across all declared sheets. "+fallbackReport.summary;fallbackReport.limitations.unshift("INCOMPLETE DRAWING CU INVENTORY: "+finalDrawingCoverage.message+" Do not treat this partial CU comparison as approval; verify all declared drawing sheets manually.");}
 await cuCalculateDepotTravel(fallbackReport,dt,qt);
 await cuApplyAuxAndPolypipeChecks(fallbackReport,dt,qt);
 fallbackReport.diagnostics={...(fallbackReport.diagnostics||{}),depot_travel:fallbackReport.depot_travel,travel_allowance_check:fallbackReport.travel_allowance_check,coordinate_review:fallbackReport.coordinate_review,supplementary_checks:fallbackReport.supplementary_checks};
 if(fallbackCodeCorrections.length)fallbackReport.limitations.unshift("One or more drawing CU codes were conservatively corrected for OCR lookalike characters using a unique DQM/source CU code. Original and corrected codes are shown in the drawing evidence; verify them visually before approval.");
  fallbackReport.limitations.unshift("Text-based CU extraction was incomplete or clipped; Gemini's CU-only inventory was used for any side flagged as clipped or not parsed. Verify every item against the PDF.");
 console.log("[dqm-cu-ai-fallback]",JSON.stringify(fallbackReport.diagnostics));
 return json(fallbackReport,200,o);
});