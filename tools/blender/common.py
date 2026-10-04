"""Original NIGHTFALL modeling helpers. Blender local Z-up; exporter converts to glTF Y-up."""
import bpy, bmesh, math, random
from mathutils import Vector

PALETTE = {
    'wood': 0x79513A, 'wood_light': 0xBF9460, 'wood_dark': 0x473B32,
    'foliage': 0x638441, 'foliage_dark': 0x385F43, 'grass': 0x8FA45D,
    'stone': 0x81877E, 'stone_dark': 0x3F494A, 'cloth': 0xB8AC80,
    'iron': 0x71838A, 'coal': 0x283033, 'copper': 0xBD7545, 'gold': 0xD4AD57,
    'silver': 0xBDC7C3, 'crystal_glow': 0x70ACBA, 'mithril_glow': 0x949BBD,
    'obsidian': 0x3D384E, 'sulfur': 0xB2AA60, 'mushroom': 0xAC604E,
    'mushroom_blue': 0x618790, 'fire_glow': 0xCC8652, 'symbol_glow': 0xA8B884,
}

def material(name):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    h = PALETTE[name]
    def linear(c): return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    color = tuple(linear(((h >> shift) & 255) / 255) for shift in (16, 8, 0)) + (1,)
    m.diffuse_color = color
    node = m.node_tree.nodes.get('Principled BSDF'); node.inputs['Base Color'].default_value = color
    node.inputs['Roughness'].default_value = .95
    if name.endswith('_glow'):
        node.inputs['Emission Color'].default_value = color; node.inputs['Emission Strength'].default_value = .16
    return m

def assign(o, mat):
    o.data.materials.clear(); o.data.materials.append(material(mat))
    for p in o.data.polygons: p.use_smooth = False
    return o

def box(pos, size, mat='wood', rotation=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=rotation)
    o=bpy.context.object; o.scale=size; return assign(o,mat)

def cylinder(pos, radius, depth, mat='wood', vertices=8, radius2=None, rotation=(0,0,0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth, location=pos, rotation=rotation)
    return assign(bpy.context.object,mat)

def bar(start, end, radius, mat='wood', vertices=7, taper=.7):
    a,b=Vector(start),Vector(end); direction=b-a
    o=cylinder((a+b)/2,radius,direction.length,mat,vertices,radius*taper)
    o.rotation_mode='QUATERNION'; o.rotation_quaternion=direction.to_track_quat('Z','Y'); return o

def blob(pos, size, mat='foliage', seed=0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=pos)
    o=bpy.context.object; rng=random.Random(seed)
    for v in o.data.vertices: v.co *= rng.uniform(.85,1.12)
    o.scale=size; return assign(o,mat)

def mesh(name, vertices, faces, mat='stone'):
    data=bpy.data.meshes.new(name); data.from_pydata(vertices,[],faces); data.update()
    o=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(o); return assign(o,mat)

def rock(pos=(0,0,0),size=(1,1,1),seed=1,style=0,mat='stone'):
    """Three irregular polygon rings, sheared shelves and asymmetric flat facets, never a sphere."""
    rng=random.Random(seed); n=6+style%3; vertices=[]
    for layer,(z,r) in enumerate(((0,.86),(.44,1),(.91,.52))):
        for i in range(n):
            angle=2*math.pi*i/n + layer*.13; k=r*rng.uniform(.78,1.17)
            vertices.append((pos[0]+size[0]*(math.cos(angle)*k+(layer-.8)*.12),pos[1]+size[1]*math.sin(angle)*k,pos[2]+size[2]*(z+(rng.uniform(-.09,.09) if layer else 0))))
    vertices.append((pos[0]+size[0]*.12,pos[1]-size[1]*.05,pos[2]+size[2]))
    faces=[tuple(reversed(range(n)))]
    for layer in range(2):
        for i in range(n):
            a=layer*n+i; b=layer*n+(i+1)%n; c=b+n; d=a+n
            if (i+style)%2: faces.extend([(a,b,c),(a,c,d)])
            else: faces.append((a,b,c,d))
    for i in range(n): faces.append((2*n+i,2*n+(i+1)%n,3*n))
    return mesh('angular_rock',vertices,faces,mat)

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for data in (bpy.data.meshes,bpy.data.materials):
        for item in list(data):
            if item.users==0: data.remove(item)

def finish(name, height=None, crown=None):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in objects:
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bm=bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
    coords=[v.co for v in o.data.vertices]; low=[min(v[i] for v in coords) for i in range(3)]; high=[max(v[i] for v in coords) for i in range(3)]
    sx=sy=(2*crown/max(high[0]-low[0],high[1]-low[1])) if crown else 1
    sz=height/(high[2]-low[2]) if height else 1
    for v in o.data.vertices:
        v.co.x=(v.co.x-(low[0]+high[0])/2)*sx; v.co.y=(v.co.y-(low[1]+high[1])/2)*sy; v.co.z=(v.co.z-low[2])*sz
    for p in o.data.polygons: p.use_smooth=False
    slots=list(o.data.materials); indices=[p.material_index for p in o.data.polygons]
    used=sorted(set(indices)); remap={old:new for new,old in enumerate(used)}
    o.data.materials.clear()
    for index in used: o.data.materials.append(slots[index])
    for p,index in zip(o.data.polygons,indices): p.material_index=remap[index]
    o.data.validate(verbose=True); o.data.update(); o.data.calc_loop_triangles()
    if any(p.area <= 1e-10 for p in o.data.polygons): raise ValueError('Degenerate face: '+name)
    return o
