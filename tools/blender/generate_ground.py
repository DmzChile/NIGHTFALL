import math
from common import box,bar,blob,cylinder,rock,mesh,finish
IDS=['grass_tuft_a','grass_tuft_b','grass_tuft_c','bush_a','bush_b','fern_a','mushroom_a','mushroom_b','fallen_branch_a','fallen_log_a','small_stones_a','small_stones_b','fallen_log_small','fallen_log_large']
def generate(name):
    if name.startswith('grass'):
        count={'a':5,'b':7,'c':9}[name[-1]]
        for i in range(count):
            a=i*2.4; x=math.cos(a)*.14; y=math.sin(a)*.14; h=.3+.045*i
            mesh('blade',[(x-.055,y,0),(x+.055,y,0),(x+math.cos(a)*.15,y+math.sin(a)*.15,h),(x,y+.035,0)],[(0,1,2),(1,3,2),(3,0,2)],'grass')
    elif name.startswith('bush'):
        count=3 if name.endswith('a') else 5
        for i in range(count):
            a=i*2.4; blob((math.cos(a)*.28,math.sin(a)*.26,.45+.09*(i%2)),(.42,.37,.45),'foliage',i+31)
        bar((0,0,0),(0,0,.45),.08,'wood_dark')
    elif name=='fern_a':
        for i in range(7):
            a=i*math.tau/7; end=(math.cos(a)*.65,math.sin(a)*.65,.24); bar((0,0,0),end,.016,'foliage',4)
            for j in range(1,5):
                t=j/5; x=end[0]*t; y=end[1]*t; z=.34*math.sin(t*math.pi)
                for sign in [-1,1]: mesh('leaf',[(x,y,z),(x-math.sin(a)*.15*sign,y+math.cos(a)*.15*sign,z-.05),(x+end[0]*.15,y+end[1]*.15,z-.015)],[(0,1,2)],'foliage')
    elif name.startswith('mushroom'):
        count=1 if name.endswith('a') else 3
        for i in range(count):
            x=(i-1)*.25 if count>1 else 0; h=.28 if i!=1 else .4
            cylinder((x,0,h/2),.05,h,'cloth',6); cylinder((x,0,h),.23,.17,'mushroom' if name.endswith('a') else 'mushroom_blue',7,.09)
    elif name.startswith('small_stones'):
        for i in range(3 if name.endswith('a') else 5):
            a=i*2.5; rock((math.cos(a)*.32,math.sin(a)*.29,0),(.16+.03*(i%2),.15,.12+.02*i),470+i,style=i)
    elif name=='fallen_branch_a':
        bar((-1,0,.12),(1,.1,.18),.09,'wood_dark')
        for i in range(3): bar((i*.45-.6,0,.15),(i*.4-.5,(-1)**i*.4,.3),.045,'wood_dark')
    else:
        large=name=='fallen_log_large'; length=3.4 if large else 1.9; r=.4 if large else .23
        cylinder((0,0,r),r,length,'wood',9,rotation=(0,math.pi/2,0))
        for sign in [-1,1]: cylinder((sign*(length/2+.003),0,r),r*.85,.015,'wood_light',9,rotation=(0,math.pi/2,0))
        for i in range(2): bar((i*.7-.4,0,r),(i*.7-.5,.43,r+.25),r*.25,'wood')
        if name!='fallen_log_small': box((0,0,r*1.95),(length*.45,r*.65,.07),'foliage_dark')
    return finish(name)
