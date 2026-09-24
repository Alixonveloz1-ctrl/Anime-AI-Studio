# Desarrollo manual por entregas

Implementa U013. Sustituye la secuencia automática documentada en staged-text-generation.md y la recuperación completa descrita en reference-recovery.md.

1. Historia: título, relato completo legible y momentos dramáticos.
2. Guion, biblias y planos: recibe la historia aprobada; conserva japonés, español, actuación, silencios y referencias visuales.
3. Sonido, música y subtítulos: recibe el guion aprobado y define la producción sonora.
4. Revisión de continuidad: recibe el conjunto aprobado; produce observaciones y una candidata final que todavía requiere aprobación.

Cada botón genera solo su entrega. La aprobación es una operación sin modelos. Los pasos posteriores requieren la versión anterior aprobada, de la misma idea y con su hash intacto. Los borradores son independientes de las versiones activas de producción.

La aplicación calcula referencias visuales desde IDs existentes, ajusta la duración provisional a 7200 frames exclusivamente dentro de los intervalos del guion y respetando pausas, y deriva la duración musical de entradas/salidas. Las piezas que exceden 184 segundos se separan en encargos consecutivos. No se fabrican medidas de audio, medios, aprobaciones ni voces. Si los intervalos son imposibles, se conserva la historia y se pide corregir únicamente el guion. La compilación final con audio medido mantiene sus validaciones.

Se guardan respuestas antes de la validación semántica y se muestran errores estructurales agrupados. Un 429 puede seguir ocurriendo: no se prometen cuotas ilimitadas ni se reenvían automáticamente los pasos aprobados. Recuperar un borrador antiguo copia solo historia, título y momentos dramáticos a una candidata para leer; no exige los campos futuros de voces o música y no llama a Gemini.

Verificación: pruebas unitarias de contratos, límites, recuperación, cuota, contexto y control de acceso; pruebas de interfaz con transporte sintético que comprueban botones y número de solicitudes; regresión de Animes. Estas pruebas no verifican Gemini real ni sustituyen la instalación del backend y la aceptación con la cuenta del propietario. No se generó contenido de pago para verificar el cambio.
