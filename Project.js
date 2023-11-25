import {defs, tiny} from './examples/common.js';
import {Color_Phong_Shader, Shadow_Textured_Phong_Shader,
    Depth_Texture_Shader_2D, Buffered_Texture, LIGHT_DEPTH_TEX_SIZE} from './examples/shadow-demo-shaders.js'

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture,
} = tiny;

const {Cube, Axis_Arrows, Textured_Phong, Subdivision_Sphere, Phong_Shader, Cone_Tip} = defs

let dx = 0;
let dy = 0;

const sensitivity = 5;

let origin = vec3(0, 0, 0); // Location of camera matrix
let camera_matrix = Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, -1), vec3(0, 1, 0)); // Camera matrix in terms of only rotations - handle translations separately
let front = vec3(0, 0, 1); // Vector facing the direction that the player can walk in (w or s movements)
let right = vec3(1, 0, 0); // Vector facing the right of the direction that the player can walk in (d or a movements)
let pitch = 0; // Variables representing camera angle
let yaw = 0; 
const TERRAIN_BOUNDS = vec3(100, 0, 100);
const BALLOON_HEALTH = [hex_color("FF0000"), hex_color("FF0000"), hex_color("0000FF"), hex_color("00FF00")]

// Overriding original movement and mouse controller to create fps controller
const Movement = 
class Movement extends defs.Movement_Controls {
    add_mouse_controls (canvas) {
        this.mouse = { "from_center": vec( 0,0 ) };
        const mouse_position = (e, rect = canvas.getBoundingClientRect()) =>
        vec( e.clientX - (rect.left + rect.right)/2, e.clientY - (rect.bottom + rect.top)/2 );
        document.addEventListener( "mouseup",   e => { this.mouse.anchor = undefined; } );
        canvas.addEventListener( "mousedown", e => { e.preventDefault(); this.mouse.anchor = mouse_position(e); } );
        canvas.addEventListener( "mousemove", e => { e.preventDefault(); this.mouse.from_center = mouse_position(e); } );
        canvas.addEventListener( "mouseout",  e => { if( !this.mouse.anchor ) this.mouse.from_center.scale_by(0) } );

        canvas.onclick = () => canvas.requestPointerLock();

        let updatePosition = (e) => {
            dx = e.movementX;
            dy = e.movementY;
          };

        let lockChangeAlert = () => {
            if (document.pointerLockElement === canvas) {
              document.addEventListener("mousemove", updatePosition, false);
            } else {
              document.removeEventListener("mousemove", updatePosition, false);
              dx = dy = 0;
            }
          };
      
          document.addEventListener('pointerlockchange', lockChangeAlert, false);
    }

    first_person_flyaround (radians_per_frame, meters_per_frame, leeway = 70) {
        if (this.thrust[2] !== 0 || this.thrust[0] !== 0)
        {
            let newOrigin;
            if (this.thrust[2] !== 0) {
                newOrigin = origin.plus(front.times(meters_per_frame * this.thrust[2] * -1));
            }
            if (this.thrust[0] !== 0) {
                newOrigin = origin.plus(right.times(meters_per_frame * this.thrust[0] * - 1))
            }
            newOrigin[0] = Math.max(-TERRAIN_BOUNDS[0], Math.min(newOrigin[0], TERRAIN_BOUNDS[0]))
            newOrigin[2] = Math.max(-TERRAIN_BOUNDS[2], Math.min(newOrigin[2], TERRAIN_BOUNDS[2]))
            origin = newOrigin;
        }
    }

    third_person_arcball (radians_per_frame) {
        pitch = pitch + sensitivity * dx * radians_per_frame;
        // Limit how much the player can look up, as in traditional fps games
        yaw = Math.max(- Math.PI / 2, Math.min(yaw + sensitivity * dy * radians_per_frame, Math.PI / 2))
        camera_matrix = Mat4.identity();
        camera_matrix = camera_matrix.times(Mat4.rotation(-pitch, 0, 1, 0));
        camera_matrix = camera_matrix.times(Mat4.rotation(-yaw, 1, 0, 0));
        // Recalculate front and right vectors every time player changes where they look
        front = Mat4.rotation(-pitch, 0, 1, 0).times(vec3(0, 0, 1))
        front = vec3(front[0], front[1], front[2])
        right = vec3(0, 1, 0).cross(front)
    }

    display (context, graphics_state, dt= graphics_state.animation_delta_time / 1000) {
        const m  = this.speed_multiplier * this.meters_per_frame,
              r  = this.speed_multiplier * this.radians_per_frame

        // TODO:  Once there is a way to test it, remove the below, because uniforms are no longer inaccessible
        // outside this function, so we could just tell this class to take over the uniforms' matrix anytime.
        if (this.will_take_over_uniforms) {
            this.reset ();
            this.will_take_over_uniforms = false;
        }

        if (!this.mouse_enabled_canvases.has(context.canvas))
        {
            this.add_mouse_controls(context.canvas);
            this.mouse_enabled_canvases.add(context.canvas);
        }

        // Move in first-person.  Scale the normal camera aiming speed by dt for smoothness:
        this.first_person_flyaround (dt * r, dt * m);
        // Also apply third-person "arcball" camera mode if a mouse drag is occurring:
        if (!this.mouse.anchor)
            this.third_person_arcball(dt * r);
        // Log some values:
        // this.pos    = this.inverse ().times (vec4 (0, 0, 0, 1));
        // this.z_axis = this.inverse ().times (vec4 (0, 0, 1, 0));
    }
}

// Objects that have a collision box should extend this class
// Position is the initial position of the object, represented as a Mat4 translation 
// Size is the size of the bounding box of the object, represented as a Mat4 scale 
// For any object that is intended to have collision, the size matrix passed in should be adjusted
// to appropriately bound the object itself
class Collidable {
    constructor(matrix, size) {
        this.collidedObjects = [];
        this.matrix = matrix;
        this.size = size; // Size is a scale matrix; if the bound is a box then this represents the dimensions of the box otherwise if the bound is a sphere
        // it represents the radius
        this.boundingBox = true; // Determines whether the bound type being used is a bounding box or a bounding sphere
        this.updateBoundBox();
    }

    updateMatrix(newMatrix) {
        this.matrix = newMatrix;
        this.updateBoundBox();
    }

    updateBoundBox() {
        this.min_x = this.matrix[0][3] - this.size[0][0];
        this.max_x = this.matrix[0][3] + this.size[0][0];
        this.min_y = this.matrix[1][3] - this.size[1][1];
        this.max_y = this.matrix[1][3] + this.size[1][1];
        this.min_z = this.matrix[2][3] - this.size[2][2];
        this.max_z = this.matrix[2][3] + this.size[2][2];
    }

    checkCollision(other) {
        let test;
        if (this.boundingBox && other.boundingBox)
        {
            test = (
                this.min_x <= other.max_x &&
                this.max_x >= other.min_x &&
                this.min_y <= other.max_y &&
                this.max_y >= other.min_y &&
                this.min_z <= other.max_z && 
                this.max_z >= other.min_z
            );
        }
        else if (!this.boundingBox && !other.boundingBox)
        {
            const distance = Math.sqrt(
                (this.matrix[0][3] - other.matrix[0][3]) * (this.matrix[0][3] - other.matrix[0][3]) +
                (this.matrix[1][3] - other.matrix[1][3]) * (this.matrix[1][3] - other.matrix[1][3]) +
                (this.matrix[2][3] - other.matrix[2][3]) * (this.matrix[2][3] - other.matrix[2][3]));
            test = distance < sphere.size[0][0] + other.size[0][0];
        }
        else if ((this.boundingBox && !other.boundingBox) || (!this.boundingBox && other.boundingBox))
        {
            const box = this.boundingBox ? this : other;
            const sphere = !this.boundingBox ? this : other;
            // get box closest point to sphere center by clamping
            const x = Math.max(box.min_x, Math.min(sphere.matrix[0][3], box.max_x));
            const y = Math.max(box.min_y, Math.min(sphere.matrix[1][3], box.max_y));
            const z = Math.max(box.min_z, Math.min(sphere.matrix[2][3], box.max_z));

            // this is the same as isPointInsideSphere
            const distance = Math.sqrt(
                (x - sphere.matrix[0][3]) * (x - sphere.matrix[0][3]) +
                (y - sphere.matrix[1][3]) * (y - sphere.matrix[1][3]) +
                (z - sphere.matrix[2][3]) * (z - sphere.matrix[2][3]));

            test = distance < sphere.size[0][0];
        }

        if (test) {
            let found = false;
            for (let i = 0; i < this.collidedObjects.length; i++) {
                if (this.collidedObjects[i] == other)
                    found = true
            }
            if (!found)
            {
                this.collidedObjects.push(other);
                other.collidedObjects.push(this);
            }
        }
        return test;
    }
}

class Projectile extends Collidable {
    constructor(matrix, size, velocity, pitch, yaw) {
        super(matrix, size);
        this.velocity = velocity;
        this.pitch = pitch;
        this.yaw = yaw;
        this.out_of_bounds = false;
    }

    // Pass in all arguments required to draw from the main scene, as well as a list of collidable objects to test for collision
    draw(context, program_state, dt, shape, material, collidables, test_box = undefined) {
        const posChange = this.velocity.times(dt * -1);
        this.updateMatrix(this.matrix.times(Mat4.translation(...posChange)))
        if (this.matrix[1][3] + this.size[1][1] <= TERRAIN_BOUNDS[1])
            this.out_of_bounds = true;

        // Debugging
        if (test_box !== undefined) {
            test_box.draw(context, program_state, this.position.times(this.size), material)
        }

        // No need to check collisions with the projectiles and the balloons because it is already checked by the balloons

        shape.draw(context, program_state, this.matrix.times(Mat4.rotation(-1 * this.pitch, 0, 1, 0)).times(Mat4.rotation(-1 * this.yaw, 1, 0, 0)).times(this.size), ((this.collidedObjects.length !== 0) && material.override({color: hex_color("FF0000")})) || material)
        this.velocity[1] = this.velocity[1] + (9.8 * dt)
    }
}

class Balloon extends Collidable {
    constructor(size, initial_pos, durability) 
    {
        super(Mat4.identity(), size);
        this.durability = durability;
        this.initial_pos = initial_pos;
        this.boundingBox = false;

        // Balloons will follow a fixed path, and how exactly it moves on this path will be based on this progress range
        this.progress = 0;
    }

    draw(context, program_state, dt, shape, material, collidables, test_box = undefined) 
    {
        this.progress += dt;
        // First, sweep upwards: parametric equation: (x = t, y = t^2, z = z)
        const stage1Time = Math.min(5, this.progress) // 0 <= t <= 5
        let matrix = Mat4.translation(stage1Time, stage1Time * stage1Time * 10 / 25, 0).times(this.initial_pos)
        if (this.progress >= 5) // 5 <= t <= 10
        {
            const stage2Time = Math.min(10 - 5, this.progress - 5)
            matrix = Mat4.translation(2.5 * stage2Time, 0, 0).times(matrix)
        }
        if (this.progress >= 10) // 10 <= t <= 41.4
        {
            const stage3Time = Math.min(41.4 - 10, this.progress - 10)
            matrix = Mat4.translation(2.5 * stage3Time, 0, 2.5 * Math.sin(stage3Time)).times(matrix)
        }
        if (this.progress >= 41.4) // 41. 4 <= t <= 60
        {
            const stage4Time = Math.min(60 - 41.4, this.progress - 41.4) * (Math.PI * 3 / 2 / (60 - 41.4))
            matrix = Mat4.translation(matrix[0][3] + 25, matrix[1][3], matrix[2][3]).times(Mat4.rotation(-stage4Time, 0, 1, 0)).times(Mat4.translation(-(matrix[0][3] + 25), -matrix[1][3], -matrix[2][3])).times(matrix)
        }
        if (this.progress >= 60) // 60 <= t <= 80
        {
            const stage5Time = Math.min(80 - 60, this.progress - 60) * (Math.PI / (80 - 60))
            matrix = Mat4.translation(matrix[0][3], matrix[1][3], matrix[2][3] + 25).times(Mat4.rotation(stage5Time, 0, 1, 0)).times(Mat4.translation(-matrix[0][3], -matrix[1][3], -(matrix[2][3] + 25))).times(matrix)
        }
        if (this.progress >= 80) // 80 <= t <= 85
        {
            const stage6Time = Math.min(85 - 80, this.progress - 80)
            matrix = Mat4.translation(0, 0, stage6Time * 2).times(matrix)
        }
        if (this.progress >= 85) // 85 <= t <= 130
        {
            const stage7Time = Math.min(130 - 85, this.progress - 85)
            matrix = Mat4.translation(-stage7Time * 2, 0, 0).times(matrix)
        }
        if (this.progress >= 130) // 130 <= t <= 135
        {
            const stage8Time = Math.min(135 - 130, this.progress - 130)
            matrix = Mat4.translation(0, 0, stage8Time * 2).times(matrix)
        }
        if (this.progress >= 135) // 135 <= t <= 215
        {
            const stage9Time = Math.min(215 - 135, this.progress - 135)
            matrix = Mat4.translation(stage9Time * 2, 0, 0).times(matrix)
        }
        if (this.progress >= 215) // 215 <= t <= 309.25
        {
            const stage10Time = Math.min(309.25 - 215, this.progress - 215)
            matrix = Mat4.translation(0, 2 * Math.sin(stage10Time), -2 * stage10Time).times(matrix)
        }
        if (this.progress >= 309.25) // 309.25 <= t <= 314.25
        {
            const stage11Time = Math.min(314.25 - 309.25, this.progress - 309.25)
            matrix = Mat4.translation(stage11Time, -stage11Time * stage11Time * 10 / 25, 0).times(matrix)
        }

        this.updateMatrix(matrix)
        
        let collided = false;
        collidables.forEach((collidable) => {
            if (this.checkCollision(collidable)) {
                collided = true;
            }
        })
        shape.draw(context, program_state, this.matrix, material.override({color: BALLOON_HEALTH[this.durability - this.collidedObjects.length]}))
    }
}

function drawTerrain(context, program_state, shape, material) {
    // Have the terrain by a large cube with its top face being stood on
    shape.draw(context, program_state, Mat4.translation(0, -2, 0).times(Mat4.scale(100, 1, 100)), material);
}

export class Project extends Scene {
    constructor() {
        super();
        this.shapes = {
            projectile: new defs.Cone_Tip(5, 5),
            sphere: new Subdivision_Sphere(4),
            bounding_box: new Cube(),
            ground: new Cube(),
        }

        this.materials = {
            phong: new Material(new Phong_Shader(), {
                color: hex_color("#0000FF"), ambient: 0.5, specularity: 1.0
            }),
            bound_box: new Material(new Phong_Shader(), {
                color: hex_color("#0000FF"), ambient: 1.0, diffusivity: 1.0,
            }),
            terrain: new Material(new Shadow_Textured_Phong_Shader(1), {
                color: color(1, 1, 1, 1), ambient: .3, diffusivity: 0.6, specularity: 0.4, smoothness: 64,
                color_texture: null,
                light_depth_texture: null
            }),
            pure: new Material(new Color_Phong_Shader(), {
                color: hex_color("#0000FF"), ambient: 1.0, diffusivity: 1.0,
            }),
            shadow: new Material(new Shadow_Textured_Phong_Shader(1), {
                color: color(1, 1, 1, 1), ambient: .3, diffusivity: 0.6, specularity: 0.4, smoothness: 64,
            }), 
            light_src: new Material(new Phong_Shader(), {
                color: color(1, 1, 1, 1), ambient: 1, diffusivity: 0, specularity: 0
            }),

        }

        this.projectiles = [];
        this.balloons = []
        this.multishot = false;
        this.shootCooldown = 1000;
        this.canShoot = true;

        this.spawnBalloons = function() {
            this.balloons.push(new Balloon(Mat4.scale(1, 1, 1), Mat4.translation(-100, 0, 0), 2))
            setTimeout(this.spawnBalloons.bind(this), 1500)
        }

        this.spawnBalloons();

        this.init_ok = false;
    }

    make_control_panel() {
        this.key_triggered_button("Shoot", [" "], () => {
            if (this.canShoot)
            {
                this.canShoot = false;
                let lookDirection = camera_matrix.times(vec4(0, 0, 1, 0));
                if (!this.multishot)
                    this.projectiles.push(new Projectile(Mat4.translation(...origin), Mat4.scale(1/2, 1/2, 1/2), lookDirection.times(50), pitch, yaw));
                else
                {
                    this.projectiles.push(new Projectile(Mat4.translation(...origin), Mat4.scale(1/2, 1/2, 1/2), Mat4.rotation(Math.PI / 12, 0, 1, 0).times(lookDirection).times(50), pitch - Math.PI / 12, yaw));
                    this.projectiles.push(new Projectile(Mat4.translation(...origin), Mat4.scale(1/2, 1/2, 1/2), lookDirection.times(50), pitch, yaw));
                    this.projectiles.push(new Projectile(Mat4.translation(...origin), Mat4.scale(1/2, 1/2, 1/2), Mat4.rotation(-Math.PI / 12, 0, 1, 0).times(lookDirection).times(50), pitch + Math.PI / 12, yaw));
                }
                setTimeout(() => this.canShoot = true, this.shootCooldown);
            }
        })
        this.key_triggered_button("Multishot", ["m"], () => {
            this.multishot = !this.multishot;
        })
        this.key_triggered_button("Supermonkey", ["q"], () => {
            if (this.shootCooldown == 0)
                this.shootCooldown = 1000;
            else
                this.shootCooldown = 0;
        })
    }

    texture_buffer_init(gl) {
        // Depth Texture
        this.lightDepthTexture = gl.createTexture();
        // Bind it to TinyGraphics
        this.light_depth_texture = new Buffered_Texture(this.lightDepthTexture);
        this.materials.terrain.light_depth_texture = this.light_depth_texture

        this.lightDepthTextureSize = LIGHT_DEPTH_TEX_SIZE;
        gl.bindTexture(gl.TEXTURE_2D, this.lightDepthTexture);
        gl.texImage2D(
            gl.TEXTURE_2D,      // target
            0,                  // mip level
            gl.DEPTH_COMPONENT, // internal format
            this.lightDepthTextureSize,   // width
            this.lightDepthTextureSize,   // height
            0,                  // border
            gl.DEPTH_COMPONENT, // format
            gl.UNSIGNED_INT,    // type
            null);              // data
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Depth Texture Buffer
        this.lightDepthFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightDepthFramebuffer);
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,       // target
            gl.DEPTH_ATTACHMENT,  // attachment point
            gl.TEXTURE_2D,        // texture target
            this.lightDepthTexture,         // texture
            0);                   // mip level
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // create a color texture of the same size as the depth texture
        // see article why this is needed_
        this.unusedTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.unusedTexture);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            this.lightDepthTextureSize,
            this.lightDepthTextureSize,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // attach it to the framebuffer
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,        // target
            gl.COLOR_ATTACHMENT0,  // attachment point
            gl.TEXTURE_2D,         // texture target
            this.unusedTexture,         // texture
            0);                    // mip level
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    render_scene(context, program_state, shadow_pass, draw_light_source=false, draw_shadow=false)
    {
        // shadow_pass: true if this is the second pass that draw the shadow.
        // draw_light_source: true if we want to draw the light source.
        // draw_shadow: true if we want to draw the shadow

        let light_position = this.light_position;
        let light_color = this.light_color;
        const t = program_state.animation_time, dt = program_state.animation_delta_time / 1000;

        program_state.draw_shadow = draw_shadow;

        if (draw_light_source && shadow_pass) {
            this.shapes.sphere.draw(context, program_state,
                Mat4.translation(light_position[0], light_position[1], light_position[2]).times(Mat4.scale(.5,.5,.5)),
                this.materials.light_src.override({color: light_color}));
        }

        drawTerrain(context, program_state, this.shapes.ground, shadow_pass ? this.materials.terrain : this.materials.pure);

        for (let i = 0; i < this.projectiles.length; i++)
        {
            if (this.projectiles[i].collidedObjects.length == 0 && !this.projectiles[i].out_of_bounds)
                this.projectiles[i].draw(context, program_state, dt, this.shapes.projectile, shadow_pass ? this.materials.terrain : this.materials.pure, this.balloons)
            else
            {
                this.projectiles.splice(i, 1);
                i--;
            }
        }
        
        for (let i = 0; i < this.balloons.length; i++)
        {
            if (this.balloons[i].collidedObjects.length < this.balloons[i].durability)
                this.balloons[i].draw(context, program_state, dt, this.shapes.sphere, shadow_pass ? this.materials.terrain : this.materials.pure, this.projectiles, this.shapes.bounding_box)
            else
            {
                this.balloons.splice(i, 1);
                i--;
            }
        } 
        
        program_state.camera_inverse = Mat4.inverse(Mat4.translation(...origin).times(camera_matrix));
    }

    display(context, program_state) {
        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new Movement());
            origin = vec3(0, 0, 8);
        }

        let t = program_state.animation_time / 1000, dt = program_state.animation_delta_time / 1000;
        const gl = context.context;

        if (!this.init_ok) {
            const ext = gl.getExtension('WEBGL_depth_texture');
            if (!ext) {
                return alert('need WEBGL_depth_texture');  // eslint-disable-line
            }
            this.texture_buffer_init(gl);

            this.init_ok = true;
        }

        // The position of the light
        this.light_position =  vec4(0, 40, -5, 1);
        // The color of the light
        this.light_color = color(
            0.667 + Math.sin(t/500) / 3,
            0.667 + Math.sin(t/1500) / 3,
            0.667 + Math.sin(t/3500) / 3,
            1
        );

        // This is a rough target of the light.
        // Although the light is point light, we need a target to set the POV of the light
        this.light_view_target = vec4(0, 0, 0, 1);
        this.light_field_of_view = 150 * Math.PI / 180; // 180 degree

        program_state.lights = [new Light(this.light_position, this.light_color, 100000)];

        // Step 1: set the perspective and camera to the POV of light
        const light_view_mat = Mat4.look_at(
            vec3(this.light_position[0], this.light_position[1], this.light_position[2]),
            vec3(this.light_view_target[0], this.light_view_target[1], this.light_view_target[2]),
            vec3(0, 1, 0), // assume the light to target will have a up dir of +y, maybe need to change according to your case
        );
        const light_proj_mat = Mat4.perspective(this.light_field_of_view, 1, 0.5, 500);
        // Bind the Depth Texture Buffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightDepthFramebuffer);
        gl.viewport(0, 0, this.lightDepthTextureSize, this.lightDepthTextureSize);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // Prepare uniforms
        program_state.light_view_mat = light_view_mat;
        program_state.light_proj_mat = light_proj_mat;
        program_state.light_tex_mat = light_proj_mat;
        program_state.view_mat = light_view_mat;
        program_state.projection_transform = light_proj_mat;
        this.render_scene(context, program_state, false,false, false);

        // Step 2: unbind, draw to the canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        program_state.view_mat = program_state.camera_inverse;
        program_state.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 0.5, 500);
        this.render_scene(context, program_state, true,true, true);

        /*
        // Step 3: display the textures
        this.shapes.ground.draw(context, program_state,
            Mat4.translation(-.99, .08, 0).times(
            Mat4.scale(0.5, 0.5 * gl.canvas.width / gl.canvas.height, 1)
            ),
            this.depth_tex.override({texture: this.lightDepthTexture})
        );
        */
    }
}
