# Referencias de planos y recuperación — 2026-09-24

> Flujo histórico: sustituido por U013 y [manual-development.md](manual-development.md).

IMG_3341 muestra REFERENCE_LINK («Faltan referencias versionadas de lugar o
reparto»). La captura no permite saber qué ID falló. El validador detecta tanto
referencias omitidas como IDs inexistentes; no se afirma haber leído el
borrador real del usuario.

La nueva preparación deriva el índice visual requerido de locationId,
visibleCharacters y props, comprobados contra las biblias. Conserva referencias
adicionales válidas y elimina duplicados; nunca inventa fichas ni adivina IDs.
Los IDs inexistentes siguen bloqueando la candidata y nombran la toma.
El validador semántico completo permanece intacto. Se conserva la respuesta
original en stages y el documento enlazado en data.

Una acción explícita «Recuperar guion guardado» reutiliza el borrador de un
trabajo de la misma idea, propietario y proyecto, cerrado con REFERENCE_LINK.
No sirve para trabajos activos o envíos inciertos. Valida y guarda una nueva
copia antes de hacer únicamente la revisión editorial pendiente. No repite
historia/biblias, planos ni sonido. El original y la versión aprobada permanecen.

Pruebas locales verifican índices incompletos, IDs desconocidos, objetos,
inmutabilidad del original y rechazo de recuperación ajena/activa/incierta.
La recuperación real sigue pendiente de instalación y lectura del borrador;
si contiene IDs no existentes, se informa sin generar otra historia.
