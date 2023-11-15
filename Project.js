import {defs, tiny} from './examples/common.js';

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
        if (this.thrust[2] !== 0) {
            origin = origin.plus(front.times(meters_per_frame * this.thrust[2] * -1));
        }
        if (this.thrust[0] !== 0) {
            origin = origin.plus(right.times(meters_per_frame * this.thrust[0] * - 1))
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
    constructor(position, size) {
        this.position = position;
        this.size = size; // Size is a scale matrix
        this.updateBoundBox();
    }

    // Call this method in any derived class whenever its position is changed (translation)
    updateBoundBox() {
        this.min_x = this.position[0][3] - this.size[0][0];
        this.max_x = this.position[0][3] + this.size[0][0];
        this.min_y = this.position[1][3] - this.size[1][1];
        this.max_y = this.position[1][3] + this.size[1][1];
        this.min_z = this.position[2][3] - this.size[2][2];
        this.max_z = this.position[2][3] + this.size[2][2];
    }

    checkCollision(other) {
        return (
            this.min_x <= other.max_x &&
            this.max_x >= other.min_x &&
            this.min_y <= other.max_y &&
            this.max_y >= other.min_y &&
            this.min_z <= other.max_z && 
            this.max_z >= other.min_z
        );
    }
}

class Projectile extends Collidable {
    constructor(position, size, velocity, pitch, yaw) {
        super(position, size);
        this.velocity = velocity;
        this.pitch = pitch;
        this.yaw = yaw;
    }

    // Pass in all arguments required to draw from the main scene, as well as a list of collidable objects to test for collision
    draw(context, program_state, dt, shape, material, collidables, test_box = undefined) {
        const posChange = this.velocity.times(dt * -1);
        this.position = this.position.times(Mat4.translation(...posChange))
        this.updateBoundBox();

        // Debugging
        if (test_box !== undefined) {
            test_box.draw(context, program_state, this.position.times(this.size), material)
        }
        let collided = false;
        collidables.forEach((collidable) => {
            if (this.checkCollision(collidable)) {
                collided = true;
            }
        })
        shape.draw(context, program_state, this.position.times(Mat4.rotation(-1 * this.pitch, 0, 1, 0)).times(Mat4.rotation(-1 * this.yaw, 1, 0, 0)), (collided && material.override({color: hex_color("FF0000")})) || material);
        this.velocity[1] = this.velocity[1] + (9.8 * dt)
    }
}

class TestCollidable extends Collidable {
    constructor(position, size) {
        super(position, size);
    }

    draw(context, program_state, shape, material, collidables) {
        let collided = false;
        collidables.forEach((collidable) => {
            if (this.checkCollision(collidable)) {
                collided = true;
            }
        })
        shape.draw(context, program_state, this.position.times(this.size), (collided && material.override({color: hex_color("FF0000")})) || material);
    }
}

export class Project extends Scene {
    /**
     *  **Base_scene** is a Scene that can be added to any display canvas.
     *  Setup the shapes, materials, camera, and lighting here.
     */
    constructor() {
        // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
        super();

        // TODO:  Create two cubes, including one with the default texture coordinates (from 0 to 1), and one with the modified
        //        texture coordinates as required for cube #2.  You can either do this by modifying the cube code or by modifying
        //        a cube instance's texture_coords after it is already created.
        this.shapes = {
            projectile: new defs.Cone_Tip(5, 5),
            sphere: new Subdivision_Sphere(4),
            bounding_box: new Cube(),
        }

        // TODO:  Create the materials required to texture both cubes with the correct images and settings.
        //        Make each Material from the correct shader.  Phong_Shader will work initially, but when
        //        you get to requirements 6 and 7 you will need different ones.
        this.materials = {
            phong: new Material(new Phong_Shader(), {
                color: hex_color("#0000FF"),
            }),
            bound_box: new Material(new Phong_Shader(), {
                color: hex_color("#0000FF")
            })
        }

        this.projectiles = [];
        this.collidables = [new TestCollidable(Mat4.translation(0, 0, 0), Mat4.scale(1, 1, 1))];
    }

    make_control_panel() {
        // TODO:  Implement requirement #5 using a key_triggered_button that responds to the 'c' key.
        this.key_triggered_button("Rotate", ["c"], () => this.rotate = !this.rotate);
        this.key_triggered_button("Shoot", [" "], () => {
            this.projectiles.push(new Projectile(Mat4.translation(...origin), Mat4.identity(), vec3(-1 * camera_matrix[2][0], -1 *  camera_matrix[2][1], camera_matrix[2][2]).times(50), pitch, yaw));
        })
    }

    display(context, program_state) {
        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new Movement());
            origin = vec3(0, 0, 8);
        }

        program_state.projection_transform = Mat4.perspective(
            Math.PI / 4, context.width / context.height, 1, 100);

        const light_position = vec4(10, 5, 10, 1);
        program_state.lights = [new Light(light_position, color(1, 1, 1, 1), 100000)];

        let t = program_state.animation_time / 1000, dt = program_state.animation_delta_time / 1000;
        let model_transform = Mat4.identity();

        this.projectiles.forEach((projectile) => projectile.draw(context, program_state, dt, this.shapes.projectile, this.materials.phong, this.collidables))

        this.collidables.forEach((collidable) => {
            collidable.draw(context, program_state, this.shapes.bounding_box, this.materials.phong, this.projectiles)
        })
        
        program_state.camera_inverse = Mat4.inverse(Mat4.translation(...origin).times(camera_matrix));
    }
}
