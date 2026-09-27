import {readWorkbook, longestPreview, filenameFor} from './data.js';
import {createEngine} from './engine.js';
import {discoverFonts, MAX_FONTS, MAX_FONT_BYTES} from './font-library.js';
import {createFontPicker} from './font-picker.js';
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const CM = 72 / 2.54;
const KEYS = ['name','tallerpuno','tallerpdos'];
const LABELS = {name:'Nombre',tallerpuno:'Taller 1',tallerpdos:'Taller 2'};
const BASE_FONTS = [
  ['serif','DejaVu Serif','DejaVuSerif.ttf'],
  ['serif-bold','DejaVu Serif · Negrita','DejaVuSerif-Bold.ttf'],
  ['sans','DejaVu Sans','DejaVuSans.ttf'],
  ['sans-bold','DejaVu Sans · Negrita','DejaVuSans-Bold.ttf'],
  ['mono','DejaVu Mono','DejaVuSansMono.ttf'],
  ['mono-bold','DejaVu Mono · Negrita','DejaVuSansMono-Bold.ttf'],
  ['mono-italic','DejaVu Mono · Cursiva','DejaVuSansMono-Oblique.ttf'],
];
const state = {rows:[], engine:null, pdfPage:null, pdfDoc:null, selected:'name', mode:'check', person:0,
  fonts:new Map(), blocks:{}, width:841.89,height:595.28, zoom:null, scale:1, rendered:{},
  undo:[],redo:[],busy:false,abort:null,renderToken:0,templateToken:0,excelToken:0,fontCounter:0,renderError:false};
let resizeTimer, renderTask, colorSnapshot=null, drag=null, fontsFinding=false, fontPicker=null, lastFontScan=0;
const fontSources=new Set(BASE_FONTS.map(([, ,file])=>new URL(`../fonts/${file}`,import.meta.url).href));
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (x,a,b) => Math.min(b,Math.max(a,x));

function defaultBlocks(width,height){
  return Object.fromEntries(KEYS.map((key,i)=>[key,{key,x:width/2,y:height/2+[2.5,-.9,1.2][i]*CM,
    width:width*.9,size:[34,22,24][i],fontId:['serif-bold','serif','serif'][i],
    color:i===0?'#ee293d':'#20262e',align:'center',lineHeight:[1.06,3,1.5][i],wrap:i!==0}]));
}
state.blocks=defaultBlocks(state.width,state.height);
function notify(message,type='info'){
  const el=$('notice');el.textContent=message;el.className=`notice ${type}`;el.hidden=!message;
}
function fail(error){console.error(error);notify(error.message||String(error),'error');}
function snapshot(){return clone(state.blocks);}
function history(before){
  if(JSON.stringify(before)===JSON.stringify(state.blocks))return;
  state.undo.push(before);if(state.undo.length>70)state.undo.shift();state.redo=[];updateHistory();
}
function updateHistory(){ $('undo').disabled=state.busy||!state.undo.length;$('redo').disabled=state.busy||!state.redo.length;}
function restore(direction){
  if(state.busy)return;const from=state[direction],to=state[direction==='undo'?'redo':'undo'];
  if(!from.length)return;to.push(snapshot());state.blocks=from.pop();updateHistory();syncControls();scheduleText();
}
function modify(fn){if(state.busy)return;const before=snapshot();fn();history(before);syncControls();scheduleText();}
function currentBlock(){return state.blocks[state.selected];}
function decoratedBlocks(){return KEYS.map(key=>{const font=state.fonts.get(state.blocks[key].fontId);return {...state.blocks[key],fontFamily:font?.family||'serif',fontBytes:font?.bytes};});}

async function loadFont(id,label,bytes,custom=false,fileName=''){
  const font=state.fonts.get(id)||{};
  const fontBytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(font.previewPending)try{await font.previewPending;}catch{}
  let {family,face}=font;
  if(!face||face.status!=='loaded'){
    family=`CertFont${++state.fontCounter}`;face=new FontFace(family,fontBytes);await face.load();document.fonts.add(face);
  }
  Object.assign(font,{id,label,family,face,custom,fileName,bytes:fontBytes});state.fonts.set(id,font);
}
async function loadPreviewFont(id){
  const font=state.fonts.get(id);if(!font)throw new Error('No se encontró la fuente.');
  if(font.face?.status==='loaded')return font;
  if(!font.previewPending)font.previewPending=(async()=>{
    let objectUrl;
    try{
      const source=font.bytes||(font.file?(objectUrl=URL.createObjectURL(font.file)):font.url);
      const family=`CertFont${++state.fontCounter}`;
      const face=new FontFace(family,typeof source==='string'?`url(${JSON.stringify(source)})`:source);
      await face.load();document.fonts.add(face);Object.assign(font,{family,face});return font;
    }finally{if(objectUrl)URL.revokeObjectURL(objectUrl);}
  })();
  try{return await font.previewPending;}catch(error){font.previewPending=null;throw error;}
}
function refreshFontMenu(sync=true){
  const select=$('font-family');select.replaceChildren();
  for(const font of state.fonts.values()){
    const option=document.createElement('option');option.value=font.id;option.textContent=font.label;if(font.family)option.style.fontFamily=font.family;select.append(option);
  }
  fontPicker?.refresh();
  if(sync)syncControls();else{select.value=currentBlock().fontId;fontPicker?.sync();}
}
async function ensureFont(id){
  const font=state.fonts.get(id);if(!font)throw new Error('No se encontró la fuente seleccionada.');
  if(font.bytes)return font;
  if(!font.pending)font.pending=(async()=>{
    let bytes;
    if(font.file)bytes=await font.file.arrayBuffer();
    else{const response=await fetch(font.url);if(!response.ok)throw new Error(`No se pudo cargar ${font.fileName}. Comprueba que el archivo siga en la carpeta de fuentes.`);bytes=await response.arrayBuffer();}
    if(bytes.byteLength>MAX_FONT_BYTES)throw new Error(`La fuente ${font.fileName} supera 25 MB.`);
    try{await loadFont(id,font.label,bytes,true,font.fileName);}catch{throw new Error(`No se pudo abrir ${font.fileName}. Usa una fuente TTF u OTF válida.`);}
    return state.fonts.get(id);
  })();
  try{return await font.pending;}catch(error){font.pending=null;throw error;}
}
async function importFontFiles(files){
  const accepted=Array.from(files).filter(file=>/\.(ttf|otf)$/i.test(file.name));
  if(!accepted.length)throw new Error('No se encontraron fuentes TTF u OTF en la selección.');
  if(accepted.length>MAX_FONTS)throw new Error(`Selecciona una carpeta con un máximo de ${MAX_FONTS} fuentes.`);
  for(const file of accepted)if(file.size>MAX_FONT_BYTES)throw new Error(`La fuente ${file.name} supera 25 MB.`);
  const ids=[];
  for(const file of accepted){
    const id=`local-${Date.now()}-${state.fonts.size}`;
    state.fonts.set(id,{id,label:file.name.replace(/\.(ttf|otf)$/i,'').replace(/_/g,' '),custom:true,fileName:file.name,file});ids.push(id);
  }
  try{await ensureFont(ids[0]);}catch(error){for(const id of ids)state.fonts.delete(id);throw error;}
  currentBlock().fontId=ids[0];
}
async function findAvailableFonts(force=false){
  if(fontsFinding)return;fontsFinding=true;lastFontScan=Date.now();$('refresh-fonts').disabled=true;
  const status=$('font-library-status');status.hidden=true;status.textContent='';
  try{
    const result=await discoverFonts({baseUrl:new URL('../',import.meta.url).href,force});
    for(const entry of result.fonts){
      const url=new URL(entry.url,new URL('../',import.meta.url)).href;if(fontSources.has(url))continue;
      fontSources.add(url);state.fonts.set(entry.id,{...entry,url,custom:true});
    }
    refreshFontMenu(false);
    status.textContent=result.warnings.join(' ');status.hidden=!result.warnings.length;
  }catch(error){status.hidden=false;status.textContent='No se pudo consultar la carpeta. Puedes cargar tus fuentes con los controles de arriba.';}
  finally{fontsFinding=false;$('refresh-fonts').disabled=state.busy;}
}
function refreshFontsIfStale(){if(!state.busy&&Date.now()-lastFontScan>60000)findAvailableFonts();}
async function selectFont(id){
  if(state.busy)return false;const before=snapshot();busy(true);
  try{await ensureFont(id);currentBlock().fontId=id;history(before);syncControls();scheduleText();return true;}
  catch(error){syncControls();fail(error);return false;}finally{busy(false);}
}
function syncControls(){
  const b=currentBlock();
  $('font-family').value=b.fontId;$('font-size').value=b.size;$('font-color').value=b.color;
  fontPicker?.sync();
  $('color-value').textContent=b.color.toUpperCase();$('text-align').value=b.align;
  $('line-height').value=Number(b.lineHeight.toFixed(2));$('block-width').value=Math.round(b.width/state.width*100);
  $('position-x').value=((b.x-state.width/2)/CM).toFixed(2);$('position-y').value=((b.y-state.height/2)/CM).toFixed(2);
  $('text-wrap').checked=b.wrap;$('font-sample').style.fontFamily=state.fonts.get(b.fontId)?.family||'serif';
  document.querySelectorAll('[data-field]').forEach(el=>{const yes=el.dataset.field===state.selected;el.classList.toggle('active',yes);el.setAttribute('aria-pressed',String(yes));});
  for(const key of KEYS)$(`block-${key}`)?.classList.toggle('selected',key===state.selected);
  $('position-status').textContent=`${LABELS[state.selected]} · X ${((b.x-state.width/2)/CM).toFixed(2)} cm · Y ${((b.y-state.height/2)/CM).toFixed(2)} cm`;
}
function choose(key,focus=false){if(state.busy)return;state.selected=key;syncControls();if(focus)$(`block-${key}`)?.focus({preventScroll:true});}
function activeRow(){
  if(state.mode==='check')return longestPreview(state.rows);
  return state.rows[state.person]||{name:'',tallerpuno:'',tallerpdos:''};
}
function setMode(mode){
  state.mode=mode;$('mode-check').classList.toggle('active',mode==='check');$('mode-person').classList.toggle('active',mode==='person');
  $('mode-check').setAttribute('aria-pressed',String(mode==='check'));$('mode-person').setAttribute('aria-pressed',String(mode==='person'));
  $('preview-explanation').hidden=mode!=='check';$('person-controls').hidden=mode!=='person';scheduleText();
}
function setPerson(index){state.person=clamp(index,0,Math.max(0,state.rows.length-1));$('person-select').value=String(state.person);scheduleText();}
function displayData(){
  const select=$('person-select');select.replaceChildren();
  state.rows.forEach((row,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${i+1}. ${row.name}`;select.append(option);});
  $('data-body').replaceChildren();
  for(const row of state.rows.slice(0,10)){
    const tr=document.createElement('tr');for(const key of ['id',...KEYS]){const td=document.createElement('td');td.textContent=row[key];td.title=row[key];tr.append(td);}$('data-body').append(tr);
  }
  $('record-count').textContent=`${state.rows.length} personas`;
  setPerson(0);updateReady();
}
function updateReady(){
  const ready=!!state.engine&&state.rows.length>0;
  $('export-zip').disabled=!ready||state.busy||state.renderError;$('preview-pdf').disabled=!ready||state.busy||state.renderError;
  $('export-title').textContent=ready?`${state.rows.length} constancia${state.rows.length===1?'':'s'} para generar`:'Prepara tus constancias';
  $('export-detail').textContent=ready?'Un PDF por persona, con texto seleccionable y fuentes incrustadas.':'Carga el Excel y la plantilla para generar los PDF.';
  $('mode-person').disabled=state.busy||!state.rows.length;$('person-prev').disabled=state.busy||!state.rows.length||state.person===0;
  $('person-next').disabled=state.busy||!state.rows.length||state.person===state.rows.length-1;
}
async function loadExcel(bytes,name){
  const token=++state.excelToken;
  const result=await readWorkbook(bytes);if(token!==state.excelToken)return;
  state.rows=result.rows;state.renderError=false;$('excel-label').textContent=`${name} · ${state.rows.length} personas`;
  displayData();scheduleText();notify(result.warnings.length?result.warnings.join(' '):`Excel cargado: ${state.rows.length} personas.`,'success');
}
async function loadTemplate(bytes,name){
  const token=++state.templateToken;notify('Abriendo la plantilla…');
  const next=await createEngine(bytes);
  const normalized=await next.templatePdf();
  const pdf=await pdfjs.getDocument({data:normalized,standardFontDataUrl:new URL('../vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../vendor/wasm/',import.meta.url).href,isEvalSupported:false}).promise;
  const page=await pdf.getPage(1);if(token!==state.templateToken){next.destroy();await pdf.destroy();return;}
  const oldW=state.width,oldH=state.height;
  renderTask?.cancel();state.engine?.destroy();if(state.pdfDoc)await state.pdfDoc.destroy();
  state.engine=next;state.pdfPage=page;state.pdfDoc=pdf;state.width=next.width;state.height=next.height;state.zoom=null;
  for(const key of KEYS){const b=state.blocks[key];b.x=b.x/oldW*state.width;b.y=b.y/oldH*state.height;b.width=b.width/oldW*state.width;}
  state.undo=[];state.redo=[];state.rendered={};state.renderError=false;updateHistory();
  $('template-label').textContent=name;$('empty-state').hidden=true;$('page-shell').hidden=false;
  $('page-size').textContent=`${(state.width/CM).toFixed(1)} × ${(state.height/CM).toFixed(1)} cm · Página 1`;
  createBlockElements();syncControls();await refreshCanvas();await renderTexts();updateReady();
  notify(next.warnings.length?next.warnings.join(' '):'Plantilla lista. Selecciona y arrastra un texto.','success');
}
function fitScale(){const viewport=$('canvas-viewport');return Math.max(.12,(viewport.clientWidth-parseFloat(getComputedStyle(viewport).paddingLeft)*2-4)/state.width);}
async function refreshCanvas(){
  if(!state.pdfPage)return;
  state.scale=state.zoom??fitScale();const w=state.width*state.scale,h=state.height*state.scale;
  $('page-shell').style.width=`${w}px`;$('page-shell').style.height=`${h}px`;
  $('zoom-value').textContent=`${Math.round(state.scale*100)}%`;
  for(const key of KEYS)positionElement(key);
  renderTask?.cancel();const ratio=Math.min(window.devicePixelRatio||1,2);
  const viewport=state.pdfPage.getViewport({scale:state.scale*ratio});
  const canvas=$('template-canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  renderTask=state.pdfPage.render({canvasContext:canvas.getContext('2d'),viewport});
  try{await renderTask.promise;}catch(error){if(error.name!=='RenderingCancelledException')fail(error);}
}
function createBlockElements(){
  $('text-layer').replaceChildren();
  for(const key of KEYS){
    const el=document.createElement('div');el.id=`block-${key}`;el.className='text-block';el.dataset.key=key;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',`${LABELS[key]}: arrastra para mover; usa las flechas para ajustar`);
    const img=document.createElement('img');img.alt='';img.draggable=false;
    const label=document.createElement('span');label.className='block-label';label.textContent=LABELS[key];
    const handle=document.createElement('span');handle.className='resize-handle';handle.dataset.resize='true';handle.title='Arrastra para ajustar el ancho';
    el.append(img,label,handle);el.addEventListener('pointerdown',startDrag);el.addEventListener('pointermove',moveDrag);el.addEventListener('pointerup',endDrag);el.addEventListener('pointercancel',cancelDrag);el.addEventListener('keydown',nudge);el.addEventListener('focus',()=>choose(key));
    $('text-layer').append(el);
  }
}
function positionElement(key){
  const el=$(`block-${key}`),b=state.blocks[key],r=state.rendered[key];if(!el)return;
  el.style.left=`${b.x*state.scale}px`;el.style.top=`${(state.height-b.y)*state.scale}px`;
  el.style.width=`${(r?.width||b.width)*state.scale}px`;el.style.height=`${Math.max(r?.height||b.size*1.3,10)*state.scale}px`;
}
function scheduleText(){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderTexts().catch(fail),65);}
async function renderTexts(){
  if(!state.engine)return;const token=++state.renderToken,engine=state.engine,row=activeRow(),blocks=decoratedBlocks();
  const warnings=[];state.renderError=false;
  try{
    const rendered=await Promise.all(blocks.map(b=>engine.renderBlock(row[b.key]||'',b)));
    if(token!==state.renderToken||engine!==state.engine)return;
    for(let i=0;i<KEYS.length;i++){
      const key=KEYS[i],r=rendered[i],el=$(`block-${key}`);state.rendered[key]=r;
      el.querySelector('img').src=r.dataUrl;el.classList.toggle('empty',r.empty);el.classList.toggle('selected',key===state.selected);
      el.querySelector('.block-label').textContent=LABELS[key]+(r.empty?' · vacío':'');positionElement(key);
      warnings.push(...r.warnings.map(w=>`${LABELS[key]}: ${w}`));
    }
    $('layout-warning').textContent=[...new Set(warnings)].join(' ');$('layout-warning').hidden=!warnings.length;
  }catch(error){if(token!==state.renderToken)return;state.renderError=true;notify(error.message,'error');}
  updateReady();
}
function hideGuides(){$('guide-x').hidden=true;$('guide-y').hidden=true;$('snap-label').hidden=true;}
function startDrag(event){
  if(state.busy||event.button!==0)return;event.preventDefault();const el=event.currentTarget,key=el.dataset.key;
  choose(key);el.focus({preventScroll:true});
  drag={key,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,block:clone(state.blocks[key]),before:snapshot(),resize:!!event.target.dataset.resize};
  el.setPointerCapture(event.pointerId);
}
function moveDrag(event){
  if(!drag||drag.pointer!==event.pointerId)return;event.preventDefault();const b=state.blocks[drag.key];
  const dx=(event.clientX-drag.startX)/state.scale,dy=(event.clientY-drag.startY)/state.scale;
  if(drag.resize){b.width=clamp(drag.block.width+dx*2,state.width*.05,state.width);syncControls();scheduleText();return;}
  b.x=clamp(drag.block.x+dx,0,state.width);b.y=clamp(drag.block.y-dy,0,state.height);
  const snap=$('snap-enabled').checked&&!event.altKey,threshold=7/state.scale;
  const sx=snap&&Math.abs(b.x-state.width/2)<threshold,sy=snap&&Math.abs(b.y-state.height/2)<threshold;
  if(sx)b.x=state.width/2;if(sy)b.y=state.height/2;
  $('guide-x').hidden=!sx;$('guide-y').hidden=!sy;$('snap-label').hidden=!sx&&!sy;
  $('snap-label').textContent=sx&&sy?'Centrado en la página':sx?'Centro horizontal':'Centro vertical';
  positionElement(drag.key);syncControls();
}
function endDrag(event){if(!drag||event.pointerId!==drag.pointer)return;history(drag.before);drag=null;hideGuides();scheduleText();}
function cancelDrag(){if(!drag)return;state.blocks=drag.before;drag=null;hideGuides();syncControls();scheduleText();}
function nudge(event){
  if(state.busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const step=event.shiftKey?10:1;
  modify(()=>{const b=currentBlock();if(event.key==='ArrowLeft')b.x-=step;if(event.key==='ArrowRight')b.x+=step;if(event.key==='ArrowUp')b.y+=step;if(event.key==='ArrowDown')b.y-=step;b.x=clamp(b.x,0,state.width);b.y=clamp(b.y,0,state.height);});
}
function numericControl(id,key,min,max,convert=x=>x){
  const el=$(id);
  let before=null;
  el.addEventListener('input',()=>{if(state.busy||el.value==='')return;const v=Number(el.value);if(!Number.isFinite(v)||v<min||v>max)return;if(!before)before=snapshot();currentBlock()[key]=convert(v);if(id==='position-x'||id==='position-y')positionElement(state.selected);scheduleText();});
  el.addEventListener('change',()=>{if(state.busy)return;const v=Number(el.value);if(Number.isFinite(v)&&el.value!==''){if(!before)before=snapshot();currentBlock()[key]=convert(clamp(v,min,max));}if(before)history(before);before=null;syncControls();scheduleText();});
  el.addEventListener('blur',()=>{if(before)history(before);before=null;});
}
function triggerDownload(bytes,type,name){
  const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function busy(value){
  state.busy=value;document.body.classList.toggle('busy',value);updateReady();updateHistory();
  fontPicker?.setDisabled(value);
  for(const id of ['excel-file','template-file','font-file','font-folder','save-design','load-design','demo-button','empty-demo','mode-check','mode-person','person-select','person-prev','person-next','longest-person'])$(id).disabled=value;
  $('refresh-fonts').disabled=value||fontsFinding;
  if(!value)updateReady();
}
async function exportZip(){
  if(state.busy||!state.engine||!state.rows.length)return;
  busy(true);state.abort=new AbortController();$('progress-panel').hidden=false;$('export-progress').value=0;notify('');
  const warnings=new Set();
  try{
    const bytes=await state.engine.generateZip(state.rows,decoratedBlocks(),{signal:state.abort.signal,
      onWarning:(list)=>list.forEach(w=>warnings.add(w)),
      onProgress:p=>{$('export-progress').value=p.percent;$('progress-label').textContent=p.phase==='zip'?'Preparando el archivo ZIP…':p.phase==='done'?'ZIP listo':`Generando constancia ${p.done} de ${p.total}…`;}});
    triggerDownload(bytes,'application/zip','constancias.zip');
    notify(`${state.rows.length} constancias generadas. ${warnings.size?'Revisa los PDF: '+[...warnings].join(' '):'El ZIP está listo para descargar.'}`,warnings.size?'info':'success');
  }catch(error){if(error.name==='AbortError')notify('Generación cancelada. No se descargó un ZIP parcial.');else fail(error);}
  finally{state.abort=null;busy(false);$('progress-panel').hidden=true;}
}
async function downloadPreview(){
  if(state.busy||!state.engine||!state.rows.length)return;busy(true);
  try{const row=activeRow();const bytes=await state.engine.generatePdf(row,decoratedBlocks());triggerDownload(bytes,'application/pdf',state.mode==='check'?'comprobacion_textos_largos.pdf':filenameFor(row));notify(state.mode==='check'?'PDF de comprobación descargado. Contiene Áj; el ZIP utiliza los datos originales.':'PDF de la persona seleccionada descargado.','success');}
  catch(error){fail(error);}finally{busy(false);}
}
function bytesToBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
function base64ToBytes(value){const s=atob(value);return Uint8Array.from(s,c=>c.charCodeAt(0));}
async function saveDesign(){
  const selected=new Set(KEYS.map(key=>state.blocks[key].fontId));
  const fonts=[...state.fonts.values()].filter(f=>f.custom&&selected.has(f.id)).map(f=>({id:f.id,label:f.label,fileName:f.fileName,data:bytesToBase64(f.bytes)}));
  const design={format:'constancias-design',version:1,page:{width:state.width,height:state.height},blocks:state.blocks,fonts};
  triggerDownload(JSON.stringify(design,null,2),'application/json','diseno_constancias.json');notify('Diseño guardado con sus ajustes y las fuentes personalizadas utilizadas.','success');
}
async function openDesign(file){
  if(file.size>110*1024*1024)throw new Error('El diseño supera 110 MB.');
  const d=JSON.parse(await file.text());
  if(d.format!=='constancias-design'||d.version!==1||!d.blocks||!d.page)throw new Error('Este archivo no es un diseño compatible de Constancias.');
  const pw=Number(d.page.width),ph=Number(d.page.height);if(!(pw>0&&ph>0&&pw<15000&&ph<15000))throw new Error('El diseño tiene dimensiones no válidas.');
  const savedFonts=Array.isArray(d.fonts)?d.fonts:[];if(savedFonts.length>3)throw new Error('El diseño contiene demasiadas fuentes.');
  const remap=new Map();
  for(const f of savedFonts){if(typeof f.data!=='string'||f.data.length>Math.ceil(MAX_FONT_BYTES/3)*4)throw new Error('Fuente no válida en el diseño.');const fontBytes=base64ToBytes(f.data);if(fontBytes.byteLength>MAX_FONT_BYTES)throw new Error('Una fuente del diseño supera 25 MB.');const id=`custom-${Date.now()}-${state.fontCounter}`;await loadFont(id,String(f.label||'Fuente importada').slice(0,100),fontBytes,true,String(f.fileName||''));remap.set(f.id,id);}
  const next={};
  for(const key of KEYS){
    const b=d.blocks[key];if(!b||!['x','y','width','size','lineHeight'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])))throw new Error('El diseño contiene posiciones o tamaños no válidos.');
    if(b.size<6||b.size>120||b.lineHeight<1||b.lineHeight>4||b.width<=0||b.width>pw*1.1||b.x<0||b.x>pw||b.y<0||b.y>ph||!/^#[0-9a-f]{6}$/i.test(b.color)||!['left','center','right'].includes(b.align))throw new Error('El diseño contiene un ajuste fuera de los valores permitidos.');
    const fontId=remap.get(b.fontId)||b.fontId;if(!state.fonts.has(fontId))throw new Error('Falta una fuente del diseño. Cárgala antes de abrirlo.');
    next[key]={key,x:b.x/pw*state.width,y:b.y/ph*state.height,width:b.width/pw*state.width,size:b.size,lineHeight:b.lineHeight,fontId,color:b.color,align:b.align,wrap:b.wrap!==false};
  }
  const before=snapshot();state.blocks=next;history(before);refreshFontMenu();scheduleText();
  notify('Diseño cargado. Las posiciones se adaptaron al tamaño de la página actual.','success');
}
async function demo(){
  if(state.busy)return;busy(true);notify('Cargando archivos de ejemplo…');
  try{
    const [excel,pdf]=await Promise.all([fetch(new URL('../examples/nombres.xlsx',import.meta.url)),fetch(new URL('../examples/plantilla_ejemplo.pdf',import.meta.url))]);
    if(!excel.ok||!pdf.ok)throw new Error('No se encontraron los archivos de ejemplo.');
    await loadExcel(await excel.arrayBuffer(),'nombres.xlsx');await loadTemplate(await pdf.arrayBuffer(),'plantilla_ejemplo.pdf');
  }catch(error){fail(error);}finally{busy(false);}
}
async function boot(){
  for(const [id,label,file]of BASE_FONTS){const response=await fetch(new URL(`../fonts/${file}`,import.meta.url));if(!response.ok)throw new Error(`No se pudo cargar la fuente ${label}. Revisa que la carpeta fonts esté junto a index.html.`);await loadFont(id,label,await response.arrayBuffer());}
  fontPicker=createFontPicker({mount:$('font-picker'),getFonts:()=>[...state.fonts.values()],getSelected:()=>currentBlock().fontId,loadFont:loadPreviewFont,onSelect:selectFont,isBusy:()=>state.busy,onOpen:refreshFontsIfStale});
  refreshFontMenu();updateReady();
  $('excel-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;busy(true);try{if(!/\.xlsx$/i.test(file.name))throw new Error('Guarda el Excel como .xlsx. El formato antiguo .xls no es compatible.');if(file.size>30*1024*1024)throw new Error('El Excel supera 30 MB.');await loadExcel(await file.arrayBuffer(),file.name);}catch(error){fail(error);}finally{e.target.value='';busy(false);}});
  $('template-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;busy(true);try{if(file.size>50*1024*1024)throw new Error('La plantilla supera 50 MB. Reduce su tamaño antes de cargarla.');await loadTemplate(await file.arrayBuffer(),file.name);}catch(error){fail(error);}finally{e.target.value='';busy(false);}});
  for(const id of ['font-file','font-folder'])$(id).addEventListener('change',async e=>{if(!e.target.files.length)return;busy(true);const before=snapshot();try{await importFontFiles(e.target.files);history(before);refreshFontMenu();scheduleText();}catch(error){history(before);refreshFontMenu();fail(error);}finally{e.target.value='';busy(false);}});
  $('refresh-fonts').addEventListener('click',()=>findAvailableFonts(true));
  document.querySelectorAll('[data-field]').forEach(el=>el.addEventListener('click',()=>choose(el.dataset.field)));
  $('font-family').addEventListener('change',e=>selectFont(e.target.value));
  $('font-color').addEventListener('input',e=>{if(state.busy)return;if(!colorSnapshot)colorSnapshot=snapshot();currentBlock().color=e.target.value;$('color-value').textContent=e.target.value.toUpperCase();scheduleText();});
  $('font-color').addEventListener('change',()=>{if(colorSnapshot)history(colorSnapshot);colorSnapshot=null;});
  $('text-align').addEventListener('change',e=>modify(()=>{currentBlock().align=e.target.value;}));
  $('text-wrap').addEventListener('change',e=>modify(()=>{currentBlock().wrap=e.target.checked;}));
  numericControl('font-size','size',6,120);numericControl('line-height','lineHeight',1,4);numericControl('block-width','width',5,100,v=>v/100*state.width);
  numericControl('position-x','x',-500,500,v=>clamp(state.width/2+v*CM,0,state.width));numericControl('position-y','y',-500,500,v=>clamp(state.height/2+v*CM,0,state.height));
  $('size-down').addEventListener('click',()=>modify(()=>{currentBlock().size=Math.max(6,currentBlock().size-1);}));$('size-up').addEventListener('click',()=>modify(()=>{currentBlock().size=Math.min(120,currentBlock().size+1);}));
  $('center-x').addEventListener('click',()=>modify(()=>{currentBlock().x=state.width/2;}));$('center-y').addEventListener('click',()=>modify(()=>{currentBlock().y=state.height/2;}));
  $('undo').addEventListener('click',()=>restore('undo'));$('redo').addEventListener('click',()=>restore('redo'));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();restore(e.shiftKey?'redo':'undo');}if(e.key==='Escape'&&drag){cancelDrag();}});
  $('mode-check').addEventListener('click',()=>setMode('check'));$('mode-person').addEventListener('click',()=>setMode('person'));
  $('person-select').addEventListener('change',e=>{setPerson(Number(e.target.value));updateReady();});$('person-prev').addEventListener('click',()=>{setPerson(state.person-1);updateReady();});$('person-next').addEventListener('click',()=>{setPerson(state.person+1);updateReady();});
  $('longest-person').addEventListener('click',()=>{let best=0;state.rows.forEach((r,i)=>{if(Array.from(r.name).length>Array.from(state.rows[best].name).length)best=i;});setPerson(best);updateReady();});
  $('zoom-in').addEventListener('click',()=>{state.zoom=clamp(state.scale*1.2,.12,2.5);refreshCanvas();});$('zoom-out').addEventListener('click',()=>{state.zoom=clamp(state.scale/1.2,.12,2.5);refreshCanvas();});$('zoom-fit').addEventListener('click',()=>{state.zoom=null;refreshCanvas();});
  let windowTimer;new ResizeObserver(()=>{clearTimeout(windowTimer);windowTimer=setTimeout(()=>{if(state.zoom===null)refreshCanvas();},100);}).observe($('canvas-viewport'));
  $('demo-button').addEventListener('click',demo);$('empty-demo').addEventListener('click',demo);
  $('export-zip').addEventListener('click',exportZip);$('preview-pdf').addEventListener('click',downloadPreview);$('cancel-export').addEventListener('click',()=>{state.abort?.abort();$('progress-label').textContent='Cancelando…';});
  $('save-design').addEventListener('click',()=>saveDesign().catch(fail));$('load-design').addEventListener('click',()=>$('design-file').click());
  $('design-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;busy(true);try{await openDesign(file);}catch(error){fail(error);}finally{e.target.value='';busy(false);}});
  busy(false);
  document.documentElement.dataset.ready='true';
  findAvailableFonts();
  window.addEventListener('focus',refreshFontsIfStale);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshFontsIfStale();});
}
busy(true);
boot().catch(error=>{fail(error);$('demo-button').disabled=true;$('empty-demo').disabled=true;});
