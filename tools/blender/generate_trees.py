import math
from common import bar, blob, cylinder, finish

IDS=['tree_small_a','tree_small_b','tree_medium_a','tree_medium_b','tree_large_a','tree_large_b','tree_world_a','dead_tree_a','dead_tree_b','tree_stump_small','tree_stump_medium','tree_stump_large']

def generate(name):
    if name.startswith('tree_stump'):
        r={'small':.22,'medium':.4,'large':.7}[name.split('_')[-1]]
        cylinder((0,0,r*.4),r,r*.8,'wood',9,r*.88)
        cylinder((0,0,r*.79),r*.82,.025,'wood_light',9)
        for i in range(3):
            a=i*2.1; bar((0,0,.1),(math.cos(a)*r*1.5,math.sin(a)*r*1.5,.05),r*.3)
        return finish(name)
    if name.startswith('dead_tree'):
        b=name.endswith('b'); h=5.2 if b else 4.1
        spine=[(0,0,0),(.1,-.1,h*.42),(-.25,.1,h*.75),(.4 if b else -.5,.15,h)]
        for i in range(3): bar(spine[i],spine[i+1],.23-i*.06,'wood_dark',7,.65)
        for i in range(5):
            a=i*2.3 + int(b); start=spine[1 if i<3 else 2]
            mid=(start[0]+math.cos(a)*(.9 if b else 1.2),start[1]+math.sin(a)*.8,start[2]+.6)
            bar(start,mid,.11,'wood_dark'); bar(mid,(mid[0]+math.cos(a+.8)*.5,mid[1]+math.sin(a+.8)*.5,mid[2]+.7),.065,'wood_dark')
        return finish(name)
    size=name.split('_')[1]; b=name.endswith('b'); h,r,c={'small':(3.6,.22,1.2),'medium':(6.5,.4,2.2),'large':(11,.7,3.8),'world':(30,1.8,9)}[size]
    cylinder((0,0,h*.28),r,h*.56,'wood',8,r*.55)
    if size=='world':
        # Separate landmark: buttress roots, bent secondary trunks, seven sprawling crown lobes.
        for i in range(7):
            a=i*math.tau/7; end=(math.cos(a)*c*.57,math.sin(a)*c*.57,h*(.58+.035*(i%3)))
            bar((0,0,h*.38),end,r*.55,'wood',8,.35)
            blob((end[0],end[1],h*.78),(c*.5,c*.43,h*.2),'foliage',i+5)
            bar((0,0,h*.11),(math.cos(a)*r*2.3,math.sin(a)*r*2.3,.1),r*.4,'wood',6,.1)
        blob((0,0,h*.84),(c*.68,c*.63,h*.16),'foliage',42)
    elif b:
        # A stepped conifer/leaning branch silhouette rather than a scaled copy of A.
        for i in range(4 if size!='small' else 3):
            z=h*(.45+i*.13); radius=c*(.95-i*.19)
            cylinder((.12*i,-.06*i,z),radius,h*.33,'foliage',7,0,rotation=(0,.03*i,.3*i))
        for i in range(3):
            a=i*2.1; bar((0,0,h*.35),(math.cos(a)*c*.6,math.sin(a)*c*.6,h*.46),r*.4)
    else:
        count={'small':2,'medium':4,'large':7}[size]
        for i in range(count):
            a=i*2.4; end=(math.cos(a)*c*.52,math.sin(a)*c*.46,h*(.57+.05*(i%3)))
            bar((0,0,h*.35),end,r*.4,'wood',7,.3)
            blob((end[0],end[1],h*(.70+.07*(i%3))),(c*.59,c*.52,h*.2),'foliage',i+7)
        if size=='large':
            for i in range(5):
                a=i*1.3; bar((0,0,.8),(math.cos(a)*r*2,math.sin(a)*r*2,.07),r*.3,'wood')
    return finish(name,h,c)
