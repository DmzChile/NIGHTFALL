import math
from common import box,cylinder,rock,finish
IDS=['ruin_wall','ruin_wall_broken','ruin_corner','ruin_column','ruin_arch','ruin_floor']
def generate(name):
    if name=='ruin_column':
        cylinder((0,0,.15),.55,.30,'stone',6,.5); cylinder((0,0,1.25),.31,2.2,'stone',7,.26)
        cylinder((0,0,2.4),.48,.25,'stone',6,.5); cylinder((0,0,1.5),.34,.09,'stone_dark',7)
    elif name=='ruin_arch':
        for x in [-1.12,1.12]:
            for i in range(5): box((x,0,i*.47+.23),(.55,.58,.44),'stone',rotation=(0,.018*(-1)**i,0))
        for i in range(5):
            a=(i+.5)*math.pi/5; box((math.cos(a)*1.11,0,2.32+math.sin(a)*.6),(.54,.58,.43),'stone',rotation=(0,math.pi/2-a,0))
    elif name=='ruin_floor':
        for x in [-.5,.5]:
            for y in [-.5,.5]: box((x,y,.1),(.96,.96,.2),'stone')
        rock((.45,.1,.2),(.15,.13,.09),841,mat='foliage_dark')
    else:
        broken=name=='ruin_wall_broken'
        for row in range(4):
            for col in range(3):
                if broken and (row==3 and col>0 or row==2 and col==2): continue
                box(((col-1)*.66,0,row*.46+.23),(.63,.44,.43),'stone',rotation=(0,(row-col)*.013,0))
        if name=='ruin_corner':
            for row in range(4):
                for col in range(2): box((-.78,.5+col*.65,row*.46+.23),(.44,.63,.43),'stone')
        if broken:
            for i in range(3): rock((.45+i*.27,-.38,0),(.27,.23,.23),850+i,i)
    return finish(name)
