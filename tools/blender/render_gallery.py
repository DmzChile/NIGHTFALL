"""Render the exported GLBs, not substitutes: blender -b -P tools/blender/render_gallery.py -- --assets public/models/nightfall"""
import bpy,sys,pathlib,json,math,argparse
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--assets',default='public/models/nightfall');p.add_argument('--output');a=p.parse_args(args)
root=pathlib.Path(a.assets).resolve();catalog=json.loads((root/'catalog.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for i,spec in enumerate(catalog['assets']):
    previous=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(root/spec['category']/(spec['id']+'.glb')))
    imported=set(bpy.context.scene.objects)-previous
    parent=bpy.data.objects.new('display/'+spec['id'],None);bpy.context.collection.objects.link(parent)
    for o in imported:
        if o.parent not in imported: o.parent=parent
    span=max(hi-lo for hi,lo in zip(spec['bounds']['max'],spec['bounds']['min']))
    parent.scale=(3.6/span,)*3;parent.location=((i%8-3.5)*5,-(i//8)*5,0)
    bpy.ops.object.text_add(location=(parent.location.x-2.1,parent.location.y-2.4,.04))
    t=bpy.context.object;t.data.body=spec['id']+'\n'+str(spec['triangles'])+' tri';t.data.size=.27;t.data.extrude=0
    mat=bpy.data.materials.get('label')
    if not mat:
        mat=bpy.data.materials.new('label');mat.diffuse_color=(.52,.63,.43,1)
    t.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,-23,-.025));ground=bpy.context.object
mat=bpy.data.materials.new('gallery_ground');mat.diffuse_color=(.06,.09,.065,1);ground.data.materials.append(mat)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1800;scene.render.resolution_y=2250;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25)
bpy.ops.object.light_add(type='AREA',location=(-15,-13,40));light=bpy.context.object;light.data.energy=26000;light.data.shape='DISK';light.data.size=28
light.rotation_euler=(Vector((0,-23,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN',location=(0,0,10));bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.35,-.4,-.6)
bpy.ops.object.camera_add(location=(0,-56,68));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=55
cam.rotation_euler=(Vector((0,-23,0))-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=90;scene.render.filepath=a.output or str(root/'gallery.jpg')
bpy.ops.render.render(write_still=True)
