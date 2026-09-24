"""Derive required visual references from explicit, validated cast/location IDs."""
import copy
from shorts.core.contracts import require

def link_references(data):
    out=copy.deepcopy(data)
    bible=out.get('bible',{})
    groups={k:{r['id'] for r in bible.get(k,[]) if isinstance(r,dict) and isinstance(r.get('id'),str)} for k in ('characters','locations','props')}
    all_ids=set().union(*groups.values())
    for shot in out.get('shots',[]):
        label=str(shot.get('id','sin ID'))
        location=shot.get('locationId');cast=shot.get('visibleCharacters');props=shot.get('props')
        require(isinstance(location,str) and location in groups['locations'],'BIBLE_LINK','La toma '+label+' usa un lugar sin ficha: '+str(location))
        for values,kind in ((cast,'characters'),(props,'props')):
            require(isinstance(values,list) and all(isinstance(v,str) and v in groups[kind] for v in values),'BIBLE_LINK','La toma '+label+' contiene IDs sin ficha en '+kind)
        existing=shot.get('referenceEntityIds',[])
        require(isinstance(existing,list) and all(isinstance(v,str) and v in all_ids for v in existing),'REFERENCE_LINK','La toma '+label+' contiene referencias que no existen en sus biblias.')
        # This is an index, not invented story content. Never guess an ID,
        # create a ficha, change cast, or discard an unknown reference.
        shot['referenceEntityIds']=list(dict.fromkeys([*existing,location,*cast,*props]))
    return out
