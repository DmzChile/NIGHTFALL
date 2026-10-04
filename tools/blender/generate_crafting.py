import math
from common import box,bar,cylinder,rock,mesh,finish
IDS=['workbench','campfire','furnace','anvil','storage_chest']
def generate(name):
    if name=='workbench':
        for x in [-.65,.65]:
            for y in [-.38,.38]: box((x,y,.46),(.14,.14,.92))
        for i in range(5): box((0,(i-2)*.2,1),(1.65,.185,.14),'wood_light')
        for i in range(3): box((0,(i-1)*.24,.25),(1.4,.2,.1))
        bar((-.65,-.38,.25),(.65,-.38,.75),.045,'wood_dark',4)
        box((-.4,-.1,1.12),(.15,.48,.08),'iron'); bar((-.4,-.1,1.13),(-.4,.23,1.14),.03)
        box((.34,0,1.15),(.32,.18,.16),'iron'); bar((.34,0,1.1),(.7,.25,1.1),.035)
    elif name=='campfire':
        for i in range(9):
            a=i*math.tau/9; rock((math.cos(a)*.65,math.sin(a)*.65,0),(.23,.2,.25),560+i,i)
        for i in range(3): cylinder((0,0,.16+i*.025),.09,1.1,'wood_dark',7,rotation=(math.pi/2,0,i*1.1))
    elif name=='furnace':
        box((-.58,0,.65),(.35,1.25,1.3),'stone'); box((.58,0,.65),(.35,1.25,1.3),'stone')
        box((0,.48,.7),(.9,.3,1.4),'stone'); box((0,0,1.45),(1.5,1.3,.4),'stone')
        box((0,-.5,.5),(.8,.12,.8),'stone_dark'); box((0,-.57,.25),(.62,.04,.22),'fire_glow')
        cylinder((.2,.18,1.85),.26,.6,'stone',6); cylinder((.2,.18,2.15),.19,.01,'stone_dark',6)
        for i in range(3): box((0,-.15+i*.18,.07),(1.35,.16,.14),'stone')
    elif name=='anvil':
        box((0,0,.12),(1,.6,.24),'wood_dark'); box((0,0,.38),(.58,.45,.45),'iron')
        profile=[(-.85,.74),(-.52,.61),(-.45,.58),(.46,.58),(.62,.75),(.62,.98),(-.45,.98),(-.93,.85)]
        vertices=[(x,y,z) for y in [-.24,.24] for x,z in profile]; n=len(profile)
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh('anvil_horn',vertices,faces,'iron')
    else:
        for i in range(5): box(((i-2)*.24,0,.36),(.225,.76,.72))
        box((0,0,.74),(1.3,.86,.14),'wood_light')
        for x in [-.45,.45]: box((x,0,.79),(.06,.88,.04),'iron'); box((x,-.39,.36),(.06,.04,.75),'iron')
        box((0,-.44,.62),(.18,.07,.24),'iron')
    return finish(name)
