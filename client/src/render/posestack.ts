/** A matrix stack like vanilla's PoseStack (column-major, operations post-multiply). */
import { mat4, multiply, type Mat4 } from './math';

export class PoseStack {
  private stack: Mat4[] = [mat4()];
  private readonly tmp = mat4();

  get last(): Mat4 {
    return this.stack[this.stack.length - 1]!;
  }

  reset(m?: Mat4): this {
    this.stack.length = 1;
    if (m) this.stack[0]!.set(m);
    else this.stack[0]!.set(IDENTITY);
    return this;
  }

  push(): void {
    const m = mat4();
    m.set(this.last);
    this.stack.push(m);
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  translate(x: number, y: number, z: number): this {
    const m = this.last;
    m[12] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    m[13] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    m[14] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    m[15] = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    return this;
  }

  scale(x: number, y: number, z: number): this {
    const m = this.last;
    for (let i = 0; i < 4; i++) {
      m[i] = m[i]! * x;
      m[4 + i] = m[4 + i]! * y;
      m[8 + i] = m[8 + i]! * z;
    }
    return this;
  }

  /** Right-handed rotation about an axis (vanilla Vector3f.XP/YP/ZP.rotationDegrees). */
  rotX(deg: number): this {
    return this.rot(0, deg);
  }
  rotY(deg: number): this {
    return this.rot(1, deg);
  }
  rotZ(deg: number): this {
    return this.rot(2, deg);
  }

  private rot(axis: number, deg: number): this {
    if (deg === 0) return this;
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const r = this.tmp;
    r.set(IDENTITY);
    if (axis === 0) {
      r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
    } else if (axis === 1) {
      r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
    } else {
      r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
    }
    multiply(this.last, this.last, r);
    return this;
  }

  mul(m: Mat4): this {
    multiply(this.last, this.last, m);
    return this;
  }
}

const IDENTITY = mat4();
