# Product models in Brutti Catalog

In Catalog Admin, open a product and go to **3D model**. Choose one model along with any texture, material or buffer files it uses. A ZIP can preserve the original folder structure. Save packages up to 50 MB after checking the model in the interactive preview. The catalog keeps the original file formats.

The viewer supports GLB and glTF, OBJ and MTL, FBX, STL, PLY, 3MF, 3DS, DAE, USD and USDZ, Draco, VRML, and XYZ point clouds. It also supports STEP, IGES, BREP, and Rhino 3DM with render meshes. Export native SketchUp, Blender or DWG files to one of these formats. CAD is rendered as a preview mesh. Compare the model and textures with the actual product before publishing.

On published product pages with a model, customers can switch between **Interactive 3D** and **Original photos**. The viewer supports orbit, zoom, reset, wireframe for meshes, and fullscreen. The browser loads the viewer only when opened and loads the CAD and compression decoders on demand.

The `catalog_product_models` migration adds a private `product-models` bucket and model references to the existing catalog project. Existing products have no model until staff attach one. Storage policies allow guests to download only packages linked to a published product. Draft, replaced and removed models follow the product's access rules. Replacing or removing a model is committed with **Save product**. Duplicating an item starts its new SKU without a model attachment.

`npm run test:e2e` checks the staff-to-customer model flow and `npm run test:db` covers model storage access. Three.js and the CAD decoders are served from the catalog build using pinned npm versions. OCCT's LGPL license and source notices are included at `model-decoder-licenses.txt` in the built catalog. The installed OCCT and Rhino distributions are served as separate assets.
