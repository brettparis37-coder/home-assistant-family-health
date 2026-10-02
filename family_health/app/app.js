"use strict";

const $ = (id) => document.getElementById(id);
const state = {children:[], childId:null, feedings:[], measurements:[], view:"home"};
const ML_PER_OZ = 29.5735295625;
const G_PER_LB = 453.59237;
const MM_PER_IN = 25.4;
const safe = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (n, digits=1) => Number(n).toLocaleString(undefined,{maximumFractionDigits:digits});
const localInput = (iso) => { const d = new Date(iso); const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (id) => { const value=$(id).value; if(!value) throw Error("Enter a date and time"); const d=new Date(value); if(Number.isNaN(d.getTime())) throw Error("Enter a valid date and time"); return d.toISOString(); };
const when = iso => new Date(iso).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
const dayKey = iso => { const d=new Date(iso); const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
const todayKey = () => dayKey(new Date().toISOString());
const selectedChild = () => state.children.find(c=>c.id===state.childId);
const volUnit = () => $("volume-unit").value;
const growthUnit = () => $("growth-unit").value;
const volume = ml => `${number(volUnit()==="oz"?ml/ML_PER_OZ:ml)} ${volUnit()==="oz"?"fl oz":"mL"}`;
const weight = g => g==null?"—":`${number(growthUnit()==="imperial"?g/G_PER_LB:g/1000,2)} ${growthUnit()==="imperial"?"lb":"kg"}`;
const length = mm => mm==null?"—":`${number(growthUnit()==="imperial"?mm/MM_PER_IN:mm/10,1)} ${growthUnit()==="imperial"?"in":"cm"}`;
const minutes = f => Math.round((new Date(f.ended_at)-new Date(f.started_at))/60000);
const ageDays = (dateStr, iso) => { const a=new Date(`${dateStr}T12:00:00`); const b=new Date(`${dayKey(iso)}T12:00:00`); return Math.round((b-a)/86400000); };
const notice = (message,error=false) => { const n=$("notice");n.textContent=message;n.classList.toggle("error",error);n.hidden=false;clearTimeout(notice.timer);notice.timer=setTimeout(()=>n.hidden=true,5000); };

async function api(path,method="GET",body){
  const res=await fetch(`api/${path}`,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  let data;try{data=await res.json()}catch{throw Error("The server returned an unreadable response")}
  if(!res.ok)throw Error(data.error||"Request failed");return data;
}
function optionList(selected){return state.children.map(c=>`<option value="${safe(c.id)}" ${c.id===selected?"selected":""}>${safe(c.name)}</option>`).join("")}
function syncSelectors(){
  for(const id of ["active-child","feeding-child","measurement-child"]){const old=$(id).value;$(id).innerHTML=optionList(id==="active-child"?state.childId:(old||state.childId)); if(!state.children.some(c=>c.id===$(id).value))$(id).value=state.childId||"";}
  for(const id of ["feeding-submit","measurement-submit"]){$(id).disabled=!state.childId}
}
async function loadChildren(){
  state.children=(await api("people")).people.filter(p=>p.profile_kind==="child");
  if(!state.children.some(c=>c.id===state.childId))state.childId=state.children[0]?.id||null;
  syncSelectors();await loadRecords();
}
async function loadRecords(){
  if(state.childId){const q=encodeURIComponent(state.childId);const [f,m]=await Promise.all([api(`feedings?person_id=${q}`),api(`measurements?person_id=${q}`)]);state.feedings=f.feedings;state.measurements=m.measurements}
  else{state.feedings=[];state.measurements=[]}
  render();
}
function setView(view){state.view=view;$("home-view").hidden=view!=="home";$("child-view").hidden=view!=="child";document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===view));render();window.scrollTo(0,0)}
function stat(label,value,note){return `<div class="stat"><div class="stat-label">${safe(label)}</div><div class="stat-value">${safe(value)}</div><div class="stat-note">${safe(note)}</div></div>`}
function render(){
  const c=selectedChild(), f=state.feedings, m=state.measurements;
  $("empty-state").hidden=!!c;$("child-empty").hidden=!!c;$("child-content").hidden=!c;$("edit-child").hidden=!c;
  $("today-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
  const today=f.filter(x=>dayKey(x.started_at)===todayKey());const last=f[0];const latestWeight=m.find(x=>x.weight_g!=null),latestLength=m.find(x=>x.length_mm!=null);
  $("overview").innerHTML=[stat("Feedings today",today.length,c?`${c.name}'s day so far`:"Add a child to begin"),stat("Last feeding",last?when(last.started_at):"—",last?typeLabel(last.kind):"No feedings yet"),stat("Last weight",latestWeight?weight(latestWeight.weight_g):"—",latestWeight?when(latestWeight.measured_at):"No weight yet"),stat("Last length",latestLength?length(latestLength.length_mm):"—",latestLength?when(latestLength.measured_at):"No length yet")].join("");
  if(!c)return;
  $("child-heading").textContent=`${c.name}'s story.`;
  const age=ageDays(c.birth_date,new Date().toISOString());
  $("child-subtitle").textContent=`Born ${new Date(`${c.birth_date}T12:00:00`).toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"})} · ${age<0?"Expected in "+(-age)+" days":age+" days old"}`;
  const visible=periodFeedings();const bottle=visible.filter(x=>x.kind!=="breast");const breast=visible.filter(x=>x.kind==="breast");
  const totalMl=bottle.reduce((n,x)=>n+x.volume_ml,0),totalMin=breast.reduce((n,x)=>n+minutes(x),0);
  $("child-stats").innerHTML=[stat("Feedings",visible.length,"Selected period"),stat("Bottle milk",volume(totalMl),`${bottle.length} bottle feeding${bottle.length===1?"":"s"}`),stat("Breastfeeding",`${number(totalMin,0)} min`,`${breast.length} session${breast.length===1?"":"s"}`),stat("Measurements",periodMeasurements().length,"Selected period")].join("");
  renderFeedingChart(visible);renderGrowthChart("weight-chart",periodMeasurements(),"weight_g",growthUnit()==="imperial"?G_PER_LB:1000,growthUnit()==="imperial"?"lb":"kg");renderGrowthChart("length-chart",periodMeasurements(),"length_mm",growthUnit()==="imperial"?MM_PER_IN:10,growthUnit()==="imperial"?"in":"cm");renderTables();
}
function cutoff(){const value=$("period").value;if(value==="all")return 0;const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-Number(value)+1);return d.getTime()}
const periodFeedings=()=>state.feedings.filter(x=>new Date(x.started_at).getTime()>=cutoff());
const periodMeasurements=()=>state.measurements.filter(x=>new Date(x.measured_at).getTime()>=cutoff());
const svg=(content,width=800,height=280)=>`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${safe(content.label||"Chart")}" preserveAspectRatio="none">${content.markup||content}</svg>`;
function emptyChart(container,message){$(container).innerHTML=svg(`<text class="empty-chart" x="50%" y="50%" text-anchor="middle">${safe(message)}</text>`)}
function renderFeedingChart(rows){
  if(!rows.length){emptyChart("feeding-chart","No feedings in this period");return}
  const dates=[];const start=cutoff()||new Date(rows[rows.length-1].started_at).setHours(0,0,0,0);const end=new Date().setHours(0,0,0,0);
  const totalDays=Math.max(1,Math.ceil((end-start)/86400000)+1),bucketDays=Math.max(1,Math.ceil(totalDays/90));
  for(let d=new Date(start),i=0;d.getTime()<=end;i++){dates.push({key:dayKey(d.toISOString()),milk:0,formula:0,min:0});d.setDate(d.getDate()+bucketDays)}
  for(const f of rows){const day=new Date(f.started_at);day.setHours(0,0,0,0);const index=Math.min(dates.length-1,Math.max(0,Math.floor((day.getTime()-start)/86400000/bucketDays)));const d=dates[index];if(f.kind==="breast")d.min+=minutes(f);else if(f.kind==="formula")d.formula+=f.volume_ml;else d.milk+=f.volume_ml}
  const divisor=volUnit()==="oz"?ML_PER_OZ:1;const maxVol=Math.max(1,...dates.map(x=>(x.milk+x.formula)/divisor));const maxMin=Math.max(1,...dates.map(x=>x.min));
  const w=800,h=280,l=42,r=46,t=20,b=35,inner=w-l-r,high=h-t-b;let marks="";
  for(let j=0;j<=4;j++){const y=t+high*j/4;marks+=`<line class="grid" x1="${l}" y1="${y}" x2="${w-r}" y2="${y}"/><text x="${l-6}" y="${y+3}" text-anchor="end">${number(maxVol*(1-j/4),0)}</text><text x="${w-r+6}" y="${y+3}">${number(maxMin*(1-j/4),0)}</text>`}
  const step=inner/dates.length,bar=Math.max(2,Math.min(24,step*.64));let points=[];
  dates.forEach((d,i)=>{const x=l+(i+.5)*step;const h1=d.milk/divisor/maxVol*high,h2=d.formula/divisor/maxVol*high;marks+=`<rect x="${x-bar/2}" y="${t+high-h1}" width="${bar}" height="${h1}" rx="2" fill="#9b9bc1"/><rect x="${x-bar/2}" y="${t+high-h1-h2}" width="${bar}" height="${h2}" rx="2" fill="#dfb295"/>`;points.push(`${x},${t+high-d.min/maxMin*high}`);if(i===0||i===dates.length-1||i%Math.max(1,Math.ceil(dates.length/6))===0)marks+=`<text x="${x}" y="${h-8}" text-anchor="middle">${d.key.slice(5)}</text>`});
  marks+=`<polyline class="breast-line" points="${points.join(" ")}"/>`;
  marks+=`<text x="${l}" y="11">${volUnit()==="oz"?"fl oz":"mL"}${bucketDays>1?` / ${bucketDays} days`:""}</text><text x="${w-r}" y="11" text-anchor="end">min${bucketDays>1?` / ${bucketDays} days`:""}</text>`;
  $("feeding-chart").innerHTML=svg(marks);
}
function renderGrowthChart(container,rows,key,divisor,unit){
  const c=selectedChild();const points=rows.filter(x=>x[key]!=null).map(x=>({day:ageDays(c.birth_date,x.measured_at),v:x[key]/divisor})).sort((a,b)=>a.day-b.day);
  if(!points.length){emptyChart(container,"No measurements in this period");return}
  const w=800,h=245,l=50,r=18,t=22,b=37,inner=w-l-r,high=h-t-b;
  const xmin=Math.min(0,...points.map(x=>x.day)),xmax=Math.max(xmin+1,...points.map(x=>x.day));let ymin=Math.min(...points.map(x=>x.v)),ymax=Math.max(...points.map(x=>x.v));const pad=Math.max((ymax-ymin)*.15,ymax*.02,.1);ymin=Math.max(0,ymin-pad);ymax+=pad;
  const px=x=>l+(x.day-xmin)/(xmax-xmin)*inner,py=x=>t+(ymax-x.v)/(ymax-ymin)*high;
  let marks="";for(let j=0;j<=3;j++){const y=t+high*j/3;marks+=`<line class="grid" x1="${l}" y1="${y}" x2="${w-r}" y2="${y}"/><text x="${l-7}" y="${y+3}" text-anchor="end">${number(ymax-(ymax-ymin)*j/3,1)}</text>`}
  const coords=points.map(x=>`${px(x)},${py(x)}`).join(" ");marks+=`<polygon class="area" points="${l},${t+high} ${coords} ${px(points[points.length-1])},${t+high}"/><polyline class="growth-line" points="${coords}"/>`;
  for(const p of points)marks+=`<circle class="growth-dot" cx="${px(p)}" cy="${py(p)}" r="4"><title>Day ${p.day}: ${number(p.v,2)} ${unit}</title></circle>`;
  for(let j=0;j<=4;j++){const value=xmin+(xmax-xmin)*j/4;marks+=`<text x="${l+inner*j/4}" y="${h-10}" text-anchor="middle">${number(value,0)}</text>`}
  marks+=`<text x="${l}" y="12">${unit}</text><text x="${w-r}" y="${h-10}" text-anchor="end">days old</text>`;$(container).innerHTML=svg(marks);
}
function renderTables(){
  const count=$("feeding-limit").value;const rows=count==="all"?state.feedings:state.feedings.slice(0,Number(count));
  $("feeding-rows").innerHTML=rows.length?rows.map(f=>`<tr><td>${safe(when(f.started_at))}</td><td><span class="tag ${safe(f.kind)}">${safe(typeLabel(f.kind))}</span></td><td>${f.kind==="breast"?`${minutes(f)} min · ${safe(when(f.started_at))}–${safe(new Date(f.ended_at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}))}`:safe(volume(f.volume_ml))}</td><td>${safe([f.breast_side,f.notes].filter(Boolean).join(" · ")||"—")}</td><td class="actions"><button class="table-action" data-action="edit-feeding" data-id="${safe(f.id)}">Edit</button><button class="table-action delete" data-action="delete-feeding" data-id="${safe(f.id)}">Delete</button></td></tr>`).join(""):`<tr><td colspan="5" class="table-empty">No feedings recorded yet</td></tr>`;
  $("measurement-rows").innerHTML=state.measurements.length?state.measurements.map(m=>`<tr><td>${safe(when(m.measured_at))}</td><td>${ageDays(selectedChild().birth_date,m.measured_at)} days</td><td>${safe(weight(m.weight_g))}</td><td>${safe(length(m.length_mm))}</td><td>${safe(m.notes||"—")}</td><td class="actions"><button class="table-action" data-action="edit-measurement" data-id="${safe(m.id)}">Edit</button><button class="table-action delete" data-action="delete-measurement" data-id="${safe(m.id)}">Delete</button></td></tr>`).join(""):`<tr><td colspan="6" class="table-empty">No growth measurements recorded yet</td></tr>`;
}
const typeLabel=kind=>({breast:"Breastfeeding",breastmilk:"Breast milk",formula:"Formula"})[kind]||kind;
function feedingFields(){const breast=$("feeding-kind").value==="breast";$("breast-fields").hidden=!breast;$("bottle-fields").hidden=breast;$("feeding-start").required=breast;$("feeding-end").required=breast;$("bottle-time").required=!breast;$("feeding-volume").required=!breast;updateDuration()}
function updateDuration(){const a=new Date($("feeding-start").value),b=new Date($("feeding-end").value);$("duration-preview").textContent=Number.isFinite(a.getTime())&&Number.isFinite(b.getTime())&&b>a?`${Math.round((b-a)/60000)} minutes`:"Start and end set the session duration."}
function resetFeeding(){ $("feeding-form").reset();$("home-volume-unit").value=volUnit();$("feeding-id").value="";$("feeding-child").value=state.childId||"";$("feeding-start").value=localInput(new Date(Date.now()-15*60000));$("feeding-end").value=localInput(new Date());$("bottle-time").value=localInput(new Date());$("feeding-submit").textContent="Save feeding";$("feeding-cancel").hidden=true;feedingFields() }
function resetMeasurement(){ $("measurement-form").reset();$("home-growth-unit").value=growthUnit();$("measurement-id").value="";$("measurement-child").value=state.childId||"";$("measurement-time").value=localInput(new Date());$("measurement-submit").textContent="Save measurement";$("measurement-cancel").hidden=true }
function resetChild(){ $("child-form").reset();$("child-id").value="";$("child-form-title").textContent="Add a child";$("child-submit").textContent="Add child";$("child-cancel").hidden=true }
async function submitFeeding(event){event.preventDefault();try{const kind=$("feeding-kind").value;const body={person_id:$("feeding-child").value,kind,started_at:toIso(kind==="breast"?"feeding-start":"bottle-time"),notes:$("feeding-notes").value};if(kind==="breast"){body.ended_at=toIso("feeding-end");body.breast_side=$("feeding-side").value||null}else{const raw=Number($("feeding-volume").value);body.volume_ml=volUnit()==="oz"?raw*ML_PER_OZ:raw}const id=$("feeding-id").value;await api(id?`feedings/${id}`:"feedings",id?"PUT":"POST",body);notice(id?"Feeding updated":"Feeding saved");resetFeeding();if(body.person_id!==state.childId){state.childId=body.person_id;syncSelectors()}await loadRecords()}catch(e){notice(e.message,true)}}
async function submitMeasurement(event){event.preventDefault();try{const rawW=$("weight").value,rawL=$("length").value;const imperial=growthUnit()==="imperial";const body={person_id:$("measurement-child").value,measured_at:toIso("measurement-time"),weight_g:rawW?Number(rawW)*(imperial?G_PER_LB:1000):null,length_mm:rawL?Number(rawL)*(imperial?MM_PER_IN:10):null,notes:$("measurement-notes").value};const id=$("measurement-id").value;await api(id?`measurements/${id}`:"measurements",id?"PUT":"POST",body);notice(id?"Measurement updated":"Measurement saved");resetMeasurement();if(body.person_id!==state.childId){state.childId=body.person_id;syncSelectors()}await loadRecords()}catch(e){notice(e.message,true)}}
async function submitChild(event){event.preventDefault();try{const body={name:$("child-name").value,birth_date:$("child-birth").value,birth_time:$("child-birth-time").value||null,profile_kind:"child",relationship:$("child-relationship").value,notes:$("child-notes").value};const id=$("child-id").value;const child=await api(id?`people/${id}`:"people",id?"PUT":"POST",body);state.childId=child.id;notice(id?"Child updated":"Child added");resetChild();await loadChildren()}catch(e){notice(e.message,true)}}
function editFeeding(id){const f=state.feedings.find(x=>x.id===id);if(!f)return;setView("home");$("feeding-id").value=f.id;$("feeding-child").value=f.person_id;$("feeding-kind").value=f.kind;feedingFields();$("feeding-start").value=localInput(f.started_at);$("feeding-end").value=f.ended_at?localInput(f.ended_at):"";$("bottle-time").value=localInput(f.started_at);$("feeding-volume").value=f.volume_ml==null?"":number(volUnit()==="oz"?f.volume_ml/ML_PER_OZ:f.volume_ml,2).replace(/,/g,"");$("feeding-side").value=f.breast_side||"";$("feeding-notes").value=f.notes;$("feeding-submit").textContent="Update feeding";$("feeding-cancel").hidden=false;$("feeding-form").scrollIntoView({behavior:"smooth",block:"center"});updateDuration()}
function editMeasurement(id){const m=state.measurements.find(x=>x.id===id);if(!m)return;setView("home");$("measurement-id").value=m.id;$("measurement-child").value=m.person_id;$("measurement-time").value=localInput(m.measured_at);$("weight").value=m.weight_g==null?"":(growthUnit()==="imperial"?m.weight_g/G_PER_LB:m.weight_g/1000).toFixed(2);$("length").value=m.length_mm==null?"":(growthUnit()==="imperial"?m.length_mm/MM_PER_IN:m.length_mm/10).toFixed(2);$("measurement-notes").value=m.notes;$("measurement-submit").textContent="Update measurement";$("measurement-cancel").hidden=false;$("measurement-form").scrollIntoView({behavior:"smooth",block:"center"})}
function editChild(){const c=selectedChild();if(!c)return;setView("home");$("child-id").value=c.id;$("child-name").value=c.name;$("child-birth").value=c.birth_date;$("child-birth-time").value=c.birth_time||"";$("child-relationship").value=c.relationship||"";$("child-notes").value=c.notes;$("child-form-title").textContent="Edit child";$("child-submit").textContent="Save child";$("child-cancel").hidden=false;$("child-form").scrollIntoView({behavior:"smooth",block:"center"})}
async function tableAction(event){const button=event.target.closest("button[data-action]");if(!button)return;const {action,id}=button.dataset;if(action==="edit-feeding")return editFeeding(id);if(action==="edit-measurement")return editMeasurement(id);if(!confirm("Delete this record? This cannot be undone."))return;try{const type=action==="delete-feeding"?"feedings":"measurements";await api(`${type}/${id}`,"DELETE");notice("Record deleted");await loadRecords()}catch(e){notice(e.message,true)}}
function updateUnitLabels(){ $("home-volume-unit").value=volUnit();$("home-growth-unit").value=growthUnit();$("volume-unit-label").textContent=volUnit()==="oz"?"fl oz":"mL";$("weight-unit-label").textContent=growthUnit()==="imperial"?"lb":"kg";$("length-unit-label").textContent=growthUnit()==="imperial"?"in":"cm";localStorage.setItem("family-health-volume-unit",volUnit());localStorage.setItem("family-health-growth-unit",growthUnit());render() }
function unitChanged(event){const isVolume=event.target.id.includes("volume"),main=$(isVolume?"volume-unit":"growth-unit"),home=$(isVolume?"home-volume-unit":"home-growth-unit"),fromHome=event.target===home,previous=fromHome?main.value:home.value,next=event.target.value;if(previous===next)return;
  if(isVolume&&$("feeding-volume").value){const n=Number($("feeding-volume").value);$("feeding-volume").value=(next==="oz"?n/ML_PER_OZ:n*ML_PER_OZ).toFixed(2)}
  if(!isVolume){for(const [id,metricFactor,imperialFactor] of [["weight",1000,G_PER_LB],["length",10,MM_PER_IN]]){if($(id).value){const canonical=Number($(id).value)*(previous==="metric"?metricFactor:imperialFactor);$(id).value=(canonical/(next==="metric"?metricFactor:imperialFactor)).toFixed(2)}}}
  main.value=next;updateUnitLabels();
}
function bind(){document.querySelectorAll(".nav").forEach(x=>x.addEventListener("click",()=>setView(x.dataset.view)));$("active-child").addEventListener("change",async e=>{state.childId=e.target.value;syncSelectors();resetFeeding();resetMeasurement();await loadRecords()});$("feeding-kind").addEventListener("change",feedingFields);for(const id of ["feeding-start","feeding-end"])$(id).addEventListener("change",updateDuration);$("feeding-form").addEventListener("submit",submitFeeding);$("measurement-form").addEventListener("submit",submitMeasurement);$("child-form").addEventListener("submit",submitChild);$("feeding-cancel").addEventListener("click",resetFeeding);$("measurement-cancel").addEventListener("click",resetMeasurement);$("child-cancel").addEventListener("click",resetChild);$("edit-child").addEventListener("click",editChild);$("period").addEventListener("change",render);$("feeding-limit").addEventListener("change",renderTables);for(const id of ["volume-unit","growth-unit","home-volume-unit","home-growth-unit"])$(id).addEventListener("change",unitChanged);for(const id of ["feeding-rows","measurement-rows"])$(id).addEventListener("click",tableAction)}
async function init(){bind();$("volume-unit").value=localStorage.getItem("family-health-volume-unit")==="oz"?"oz":"ml";$("growth-unit").value=localStorage.getItem("family-health-growth-unit")==="imperial"?"imperial":"metric";updateUnitLabels();resetFeeding();resetMeasurement();try{await loadChildren()}catch(e){notice(`Unable to load records: ${e.message}`,true)}}
init();

