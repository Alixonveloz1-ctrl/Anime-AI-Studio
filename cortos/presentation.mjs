// Presentation only. IDs and provider states stay in data, never in labels.
export const steps=['Historia','Personajes','Escenas','Exportar'];
const names={queued:'En espera',running:'Preparando',waiting_provider:'Procesando en Google',awaiting_review:'Listo para revisar',succeeded:'Terminado',failed:'No se completó',cancelled:'Cancelado',cancel_requested:'Cancelando',submitted_unknown:'Pendiente de comprobar',approved:'Aprobado',candidate:'Por revisar',stale:'Necesita revisión',needs_review:'Por revisar',quarantined:'Archivo no utilizable',image:'Imagen',veo:'Video',veo_silent_validated:'Video',pcm:'Audio',ideas:'Ideas',develop:'Guion y biblias',revise:'Corrección',tts:'Voz',music:'Música',analyze:'Sincronización',review:'Revisión',transcribe:'Tiempos de voz',media:'Preparación del sonido',preview:'Vista previa',render:'Exportación',frames:'Fotogramas',import:'Importación',hold:'Ilustración',camera2d:'Cámara 2D',localized:'Animación localizada',dialogue:'Diálogo',thought:'Pensamiento',narration:'Narración',system:'Voz del sistema'};
export const label=value=>names[value]||String(value||'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ');
export const terminal=state=>['awaiting_review','succeeded','failed','cancelled','submitted_unknown'].includes(state);
export function versions(rows,selectedId){
 const sorted=[...rows].sort((a,b)=>(a.created||0)-(b.created||0));
 const current=sorted.find(x=>x.id===selectedId)||sorted.filter(x=>x.approvalState==='approved').at(-1);
 const candidate=sorted.filter(x=>x.approvalState==='candidate').at(-1);
 const visible=[candidate,current].filter((x,i,a)=>x&&a.indexOf(x)===i);
 if(!visible.length&&sorted.length)visible.push(sorted.at(-1));
 return {visible,history:sorted.filter(x=>!visible.includes(x)).reverse()};
}
export function taskActions(job){
 if(['queued','running','waiting_provider','cancel_requested'].includes(job.state)){
  const recover=job.state==='queued'&&!job.dispatchState||job.state==='waiting_provider'&&['VEO_PENDING','SPEECH_PENDING'].includes(job.errorCode);
  return {cancel:job.state!=='cancel_requested',recover:!!recover,inspect:!!job.dispatchUnknown};
 }
 return {cancel:false,recover:false,inspect:job.state==='submitted_unknown'};
}
export function entityName(data,id){
 if(!data)return 'Recurso';
 for(const group of ['characters','locations','props']){const item=data.bible?.[group]?.find(x=>x.id===id);if(item)return item.name;}
 let n=data.shots?.findIndex(x=>x.id===id);if(n>=0)return 'Toma '+(n+1);
 const voice=data.utterances?.find(x=>x.id===id);if(voice)return entityName(data,voice.speakerId)+' · '+voice.spanish;
 n=data.musicRequests?.findIndex(x=>x.id===id);if(n>=0)return 'Música '+(n+1);
 return data.soundRequests?.find(x=>x.id===id)?.name||'Recurso';
}

const fields={objective:'Objetivo',relationships:'Relaciones',speech:'Forma de hablar',costumes:'Vestuario',referencePrompt:'Referencia visual',japaneseReading:'Lectura japonesa',languageCode:'Idioma',direction:'Dirección',visibleCharacters:'Personajes visibles',offscreenCharacters:'Personajes fuera de campo',referenceEntityIds:'Referencias de continuidad',locationId:'Lugar',speakerId:'Personaje',shotId:'Toma',beatId:'Unidad dramática',type:'Tipo de voz',function:'Función de la toma',required:'Necesario',eventDescription:'Acción que produce el sonido',startFrame:'Inicio (fotogramas)',endFrame:'Final (fotogramas)',sourceInSample:'Entrada del audio (muestras)',fadeInSamples:'Fundido de entrada (muestras)',fadeOutSamples:'Fundido de salida (muestras)',owner:'Poseedor',state:'Estado',change:'Cambio dramático',visible:'Qué se ve',audible:'Qué se oye',intention:'Intención',emotion:'Emoción',preferredFrames:'Duración prevista (fotogramas)',issues:'Observaciones',coverage:'Cobertura',uncertainty:'Puntos por comprobar',distinct:'Propuestas distintas',faithful:'Fidelidad al concepto',name:'Nombre',description:'Descripción',age:'Edad',layout:'Distribución',entrances:'Entradas',windows:'Ventanas',furniture:'Mobiliario',light:'Luz',soundZones:'Zonas sonoras'};
export const fieldLabel=key=>fields[key]||label(key);
