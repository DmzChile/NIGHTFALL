import math
from common import rock, bar, finish
IDS=['stone_node','coal_node','copper_node','iron_node','gold_node','rare_crystal_node','silver_node','mithril_node','obsidian_node','sulfur_node']
def generate(name):
    i=IDS.index(name); rock(size=(.84,.65,1.25),seed=170+i,style=1)
    mat=['stone','coal','copper','iron','gold','crystal_glow','silver','mithril_glow','obsidian','sulfur'][i]
    if i:
        for j in range(5 if i not in [5,7] else 4):
            a=j*2.3+i*.4; x=math.cos(a)*.55; y=math.sin(a)*.44; z=.65+.10*(j%3)
            if i in [5,7]: bar((x,y,z),(x*1.4,y*1.4,z+.6),.18,mat,5,.02)
            else: rock((x,y,z),(.24,.20,.33),300+i*10+j,j,mat)
    return finish(name)
