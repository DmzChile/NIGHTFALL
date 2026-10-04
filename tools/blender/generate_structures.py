import math
from common import box,finish
IDS=['wood_wall','wood_wall_window','wood_wall_door','wood_floor','wood_roof','wood_roof_corner','wood_beam','wood_pillar','stone_wall','stone_floor']
def generate(name):
    if name.startswith('wood_wall'):
        for x in [-.93,.93]: box((x,0,1.2),(.14,.2,2.4),'wood_dark')
        for i in range(8):
            z=i*.30+.15
            if name.endswith('door') and z<1.95:
                for x in [-.7,.7]: box((x,0,z),(.6,.12,.28),'wood_light')
            elif name.endswith('window') and .8<z<1.75:
                for x in [-.73,.73]: box((x,0,z),(.54,.12,.28),'wood_light')
            else: box((0,0,z),(2,.12,.28),'wood_light')
    elif name=='wood_floor':
        for i in range(8): box(((i-3.5)*.25,0,.08),(.235,2,.16),'wood_light')
    elif name=='wood_roof':
        for i in range(8): box(((i-3.5)*.25,0,.45),(.235,2,.11),'wood',rotation=(.38,0,0))
    elif name=='wood_roof_corner':
        for i in range(6):
            span=2-i*.25; box((0,(i-2.5)*.28,.20+i*.10),(span,.30,.10),'wood',rotation=(.38,0,0))
        box((0,0,.36),(.12,2,.12),'wood_dark',rotation=(.38,0,0))
    elif name=='wood_beam': box((0,0,.12),(2,.24,.24),'wood_dark')
    elif name=='wood_pillar': box((0,0,1.2),(.24,.24,2.4),'wood_dark')
    elif name=='stone_wall':
        for row in range(5):
            for col in range(4): box(((col-1.5)*.5,0,row*.48+.24),(.48,.38,.46),'stone')
    elif name=='stone_floor':
        for x in [-.5,.5]:
            for y in [-.5,.5]: box((x,y,.10),(.98,.98,.2),'stone')
    return finish(name)
