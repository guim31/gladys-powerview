// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+), declared in the manifest `scene_actions`.
//
// `activate_scene` runs a PowerView scene from a Gladys scene. Its `scene`
// field lists the integration's devices (`source: "devices"`, the only
// dynamic list the core offers): each PowerView scene is a device, named
// "<scene> (PowerView scene)". It resolves the number of shades the hub
// says it moves, for the following actions of the scene.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async activate_scene(hub, { fields }) {
    const shadeCount = await hub.activateScene(fields.scene);
    return { shade_count: shadeCount };
  },
};
