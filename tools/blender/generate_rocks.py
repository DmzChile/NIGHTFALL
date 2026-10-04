from common import rock, finish
IDS=['rock_small_a','rock_small_b','rock_medium_a','rock_medium_b','rock_medium_c','rock_large_a','rock_large_b','rock_cliff_a']
SHAPES=[(.5,.34,.4),(.32,.5,.7),(1,.7,1.2),(1.25,.8,.85),(.65,.7,1.75),(1.9,1.4,2.6),(1.45,1.1,3.1),(2.1,.9,4.2)]
def generate(name):
    i=IDS.index(name); s=SHAPES[i]; rock(size=s,seed=53+i*7,style=i)
    if i in [3,5,7]: rock(pos=(s[0]*.45,.15,0),size=(s[0]*.65,s[1]*.8,s[2]*.47),seed=120+i,style=i+2)
    return finish(name)
