# Desarrollo manual por entregas

Implementa U013 y U016. Sustituye la secuencia automática documentada en staged-text-generation.md y la recuperación completa descrita en reference-recovery.md.

1. Historia: título, relato completo legible y momentos dramáticos.
2. Guion, biblias y planos: primero genera las biblias; después, una sola pulsación escribe el guion entero en tramos de hasta 48 segundos previstos, encadenados y guardados uno a uno. Cada parte usa la historia completa y los tramos previos. Conserva japonés, español, actuación, silencios y referencias visuales.
3. Sonido, música y subtítulos: recibe el guion aprobado y define la producción sonora.
4. Revisión de continuidad: recibe el conjunto aprobado; produce observaciones y una candidata final que todavía requiere aprobación.

Una pulsación escribe TODO el texto: los cuatro pasos seguidos, aprobando cada entrega y encadenando los tramos del guion, y termina dejando el guion en producción. Aprobar una entrega es una operación sin modelos. Detener la cadena o un fallo conservan lo escrito, y la siguiente pulsación sigue desde ahí. Bajo «Hacer sólo este paso» siguen estando «Generar sólo …» y «Aprobar este paso y parar aquí», para leer una entrega antes de pagar la siguiente; «Generar otra versión de esta parte» rehace un solo tramo. Imagen, video y voz se piden toma a toma en Escenas: eso no lo encadena nada. Las entregas parciales no se pueden aprobar como guion completo. Los pasos posteriores requieren la versión anterior aprobada, de la misma idea y con su hash intacto. Los borradores son independientes de las versiones activas de producción.

La aplicación calcula referencias visuales desde IDs existentes, conserva la duración provisional entre 6840 y 7560 frames (285–315 segundos), exclusivamente dentro de los intervalos del guion y respetando pausas, y deriva la duración musical de entradas/salidas. Las piezas que exceden 184 segundos se separan en encargos consecutivos. No se fabrican medidas de audio, medios, aprobaciones ni voces. Si los intervalos son imposibles, se conserva la historia y se pide corregir únicamente el guion. La compilación final con audio medido mantiene sus validaciones.

Se guardan respuestas antes de la validación semántica y se muestran errores estructurales agrupados. Un 429 puede seguir ocurriendo: no se prometen cuotas ilimitadas ni se reenvían automáticamente los pasos aprobados. Recuperar un borrador antiguo copia solo historia, título y momentos dramáticos a una candidata para leer; no exige los campos futuros de voces o música y no llama a Gemini.

Verificación: pruebas unitarias de contratos, límites, recuperación, cuota, contexto y control de acceso; pruebas de interfaz con transporte sintético que comprueban botones y número de solicitudes; regresión de Animes. Estas pruebas no verifican Gemini real ni sustituyen la instalación del backend y la aceptación con la cuenta del propietario. No se generó contenido de pago para verificar el cambio.
