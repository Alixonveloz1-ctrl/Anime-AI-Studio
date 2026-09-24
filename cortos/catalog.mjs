// Cortos owns this catalogue. Animes keeps its existing choices and rules.
// Values already accepted by the installed service remain stable.
export const genres = [
 ['accion','acción','Acción'],['fantasia','fantasía','Fantasía'],['isekai','isekai','Isekai'],
 ['mecha','mecha','Mecha'],['romcom','comedia romántica','Comedia Romántica'],['drama','drama','Drama'],
 ['slice_of_life','vida cotidiana','Slice of Life / Vida cotidiana'],['terror','terror','Terror / Horror'],
 ['psicologico','psicológico','Psicológico'],['misterio','misterio','Misterio'],['deportes','deportes','Deportes'],
 ['sci_fi','ciencia ficción','Ciencia Ficción'],['aventura','aventura','Aventura'],['sobrenatural','sobrenatural','Sobrenatural'],
 ['supervivencia','supervivencia','Supervivencia'],['videojuego','videojuego/sistema','Videojuego / Sistema'],
 ['donghua','donghua','Donghua / Cultivación'],[null,'romance','Romance'],[null,'comedia','Comedia'],
].map(([legacyId,value,label])=>({legacyId,value,label}));
export const subgenres = [
 ['psicologico','psicológico','Psicológico'],['romance','romance','Romance'],['ecchi','ecchi adulto no explícito','Ecchi'],
 ['harem','harem','Harem'],['harem_inverso','harem inverso','Harem Inverso'],['comedia','comedia','Comedia'],
 ['dark','dark / oscuro','Dark / Oscuro'],['gore','gore / violento','Gore / Violento'],['misterio','misterio','Misterio'],
 ['revenge','venganza','Revenge / Venganza'],['overpowered','overpowered','Overpowered'],
 ['slice_of_life','vida cotidiana','Slice of Life'],['musica','música / arte','Música / Arte'],['deporte','deporte','Deporte'],
 ['mafia','mafia / crimen','Mafia / Crimen'],['escolar','escolar','Escolar'],['militar','militar','Militar'],
 ['reencarnacion','reencarnación','Reencarnación'],['viaje_tiempo','viaje en el tiempo','Viaje en el Tiempo'],
 ['apocalipsis','apocalipsis','Apocalipsis'],['idols','idols / fama','Idols / Fama'],['medicina','medicina / ciencia','Medicina / Ciencia'],
 ['sistema_awakening','sistema / awakening','Sistema / Awakening'],
 ...['absurdo','humor negro','sátira','tensión romántica','tragedia','suspenso','terror psicológico','fantasía oscura','misterio sobrenatural','rivalidad','entrenamiento/superación','sistema/progresión','exploración','relación laboral','familia','reencuentro','conflicto moral','combate táctico'].map(x=>[null,x,x[0].toUpperCase()+x.slice(1)]),
].map(([legacyId,value,label])=>({legacyId,value,label}));
export function storyChoice(value, selected=[]) {
 if(!genres.some(x=>x.value===value))throw new Error('Selecciona un género.');
 const choices=[...new Set(selected)];
 // Donghua cultivation is the explicit fantasy + cultivation combination.
 // Both instructions are persisted and reach the director, including existing
 // installations whose genre enum predates this expanded selector.
 return value==='donghua'
   ? {genre:'fantasía',subgenres:[...new Set(['donghua / cultivación',...choices])]}
   : {genre:value,subgenres:choices};
}
