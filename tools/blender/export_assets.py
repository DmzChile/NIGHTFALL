"""blender --background --python tools/blender/export_assets.py -- --output public/models/nightfall"""
import bpy, sys, pathlib, json, argparse, math
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from common import reset, PALETTE
import generate_trees,generate_rocks,generate_resources,generate_ground,generate_crafting,generate_props,generate_ruins,generate_structures
PACK=[('trees',generate_trees),('rocks',generate_rocks),('ores',generate_resources),('ground',generate_ground),('crafting',generate_crafting),('props',generate_props),('ruins',generate_ruins),('building',generate_structures)]
def run(output, category=None):
    output=pathlib.Path(output).resolve(); output.mkdir(parents=True,exist_ok=True)
    entries=[]
    for cat,module in PACK:
        if category and cat!=category: continue
        folder=output/cat; folder.mkdir(exist_ok=True)
        for name in module.IDS:
            reset(); o=module.generate(name); o.data.calc_loop_triangles(); tris=len(o.data.loop_triangles)
            mats=len(set(p.material_index for p in o.data.polygons))
            if tris>1500 or mats>4: raise ValueError(f'{name}: triangle/material budget exceeded {tris}/{mats}')
            if not all(math.isfinite(v) for p in o.data.vertices for v in p.co): raise ValueError(name+': non-finite position')
            vertices=[v.co for v in o.data.vertices]
            low=[min(v[i] for v in vertices) for i in range(3)]; high=[max(v[i] for v in vertices) for i in range(3)]
            bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
            bpy.ops.export_scene.gltf(filepath=str(folder/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_texcoords=False,export_materials='EXPORT')
            entries.append(dict(id=name,category=cat,file=f'/models/nightfall/{cat}/{name}.glb',triangles=tris,materials=mats,bounds=dict(min=[round(low[0],6),round(low[2],6),round(-high[1],6)],max=[round(high[0],6),round(high[2],6),round(-low[1],6)]),source='Blender '+bpy.app.version_string))
            print('EXPORTED',name,tris,mats,flush=True)
    path=output/'catalog.json'
    if category and path.exists(): entries=[a for a in json.loads(path.read_text())['assets'] if a['category']!=category]+entries
    path.write_text(json.dumps(dict(generator='Blender '+bpy.app.version_string,coordinate='Y-up',pivot='bottom center',palette=PALETTE,assets=entries),indent=2)+'\n')
    return entries
if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--output',default='public/models/nightfall'); p.add_argument('--category')
    a=p.parse_args(args); run(a.output,a.category)
