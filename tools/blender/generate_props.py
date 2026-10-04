import math
from common import box,bar,cylinder,rock,blob,mesh,finish
IDS=['wood_crate','barrel','sack','wood_cart','wood_fence','broken_fence','signpost','torch_post','tent','broken_cart','totem']
def generate(name):
    if name=='wood_crate':
        box((0,0,.42),(.82,.82,.84),'wood_light')
        for x in [-.35,.35]:
            for y in [-.43,.43]: box((x,y,.42),(.12,.07,.84))
        for y in [-.45,.45]: bar((-.34,y,.12),(.34,y,.72),.055,'wood',4,1)
    elif name=='barrel':
        cylinder((0,0,.45),.43,.9,'wood',10,.37)
        for z in [.16,.70]: cylinder((0,0,z),.442,.09,'iron',10,.43)
        cylinder((0,0,.905),.36,.04,'wood_light',10)
        for i in range(5): box(((i-2)*.135,0,.93),(.12,.61,.025),'wood_light')
    elif name=='sack':
        blob((0,0,.36),(.42,.34,.45),'cloth',731); cylinder((0,0,.77),.09,.14,'cloth',7,.14)
        cylinder((0,0,.75),.12,.045,'wood_dark',7)
    elif name in ['wood_cart','broken_cart']:
        broken=name=='broken_cart'
        for i in range(5 if not broken else 3): box(((i-2)*.22,0,.48),(.2,1.5,.12),'wood_light')
        for x in [-.57,.57]:
            for z in [.65,.85]: box((x,0,z),(.08,1.65,.10))
        for x in [-.71,.71]:
            if broken and x>0: continue
            cylinder((x,0,.4),.4,.10,'wood_dark',10,rotation=(0,math.pi/2,0))
            cylinder((x,0,.4),.29,.115,'wood_light',8,rotation=(0,math.pi/2,0))
        for x in [-.45,.45]: bar((x,-.65,.45),(x,-2,.28),.055,'wood',4,1)
        if broken: box((.52,.1,.64),(.08,1.4,.09),'wood',rotation=(0,.8,.3))
    elif name in ['wood_fence','broken_fence']:
        broken=name=='broken_fence'
        for x in [-.85,.85]: box((x,0,.6),(.18,.18,1.2))
        for z in [.4,.95]: box((-.15 if broken else 0,0,z),(1.4 if broken else 2,.12,.14),'wood_light',rotation=(0,.18 if broken else 0,0))
    elif name=='signpost':
        box((0,0,.75),(.14,.14,1.5)); box((.1,0,1.3),(1,.16,.42),'wood_light',rotation=(0,.07,0))
        box((.1,-.09,1.3),(.56,.02,.06),'wood_dark')
    elif name=='torch_post':
        cylinder((0,0,.85),.10,1.7,'wood',7)
        cylinder((0,0,1.72),.18,.20,'iron',7,.22); cylinder((0,0,1.98),.13,.42,'fire_glow',5,0)
    elif name=='tent':
        mesh('canvas',[(-1,-1,0),(1,-1,0),(0,-1,1.75),(-1,1,0),(1,1,0),(0,1,1.75)],[(0,2,5,3),(2,1,4,5),(3,5,4)],'cloth')
        for y in [-1.1,1.1]: bar((-.95,y,0),(.05,y,1.8),.055); bar((.95,y,0),(-.05,y,1.8),.055)
        bar((0,-1.3,1.8),(0,1.2,1.8),.06)
        for x in [-1.4,1.4]: bar((x,-1.5,0),(x*.5,-1,.8),.016,'wood_dark',4)
    else:
        cylinder((0,0,.24),.9,.48,'stone',7,.72)
        cylinder((0,0,1.40),.38,2.5,'wood_dark',7,.26)
        for z in [.85,1.70,2.45]: box((0,0,z),(1.2,.42,.23),'stone')
        mesh('sigil',[(0,-.23,2.85),(-.42,-.23,2.43),(0,-.23,2.01),(.42,-.23,2.43),(0,-.33,2.43)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'symbol_glow')
        cylinder((0,0,3.05),.52,.65,'stone',6,.22)
    return finish(name)
