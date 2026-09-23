"""Coarse detections are alternatives, not a license to choose the first hit."""
import math
from .contracts import require,integer

def contact_options(result,duration):
    require(result.get('visible') is True,'EVENT_UNCERTAIN','No se identificó contacto visible; usa ajuste manual')
    rows=result.get('occurrences') or [{'seconds':result.get('approxSeconds'),'description':result.get('evidence','')}]
    require(isinstance(rows,list) and 0<len(rows)<=30,'EVENT_SCHEMA','Lista de contactos inválida')
    options=[]
    for row in rows:
        require(isinstance(row,dict),'EVENT_SCHEMA','Contacto inválido')
        seconds=row.get('seconds',row.get('approxSeconds'))
        require(type(seconds) in (int,float) and math.isfinite(seconds) and 0<=seconds<duration,'EVENT_TIME','Contacto fuera del video recibido')
        options.append({'seconds':seconds,'description':str(row.get('description',row.get('evidence','')))[:1000]})
    return sorted(options,key=lambda x:x['seconds'])

def choose_contact(options,index=None):
    if index is None:
        return options[0] if len(options)==1 else None
    return options[integer(index,'ocurrencia',0,len(options)-1)]
