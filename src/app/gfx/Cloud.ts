import {
  vec3,
  float,
  Fn,
  vec4,
  uniform,
  cameraPosition,
  normalize,
  positionWorld,
  modelWorldMatrixInverse,
  min,
  max,
  If,
  Loop,
  exp,
  clamp,
  uint,
  positionLocal,
  abs,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { GUI } from "lil-gui";
import { createNoiseTexture } from "./utils/createNoiseTexture";
import { sample3D } from "./utils/sample3D";

interface TextureConfig {
  size: number;
  slicesX: number;
  slicesY: number;
}

export class Cloud {
  private scene: THREE.Scene;
  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.MeshBasicNodeMaterial;
  private mesh!: THREE.Mesh;
  private renderer!: THREE.WebGPURenderer;

  private gui!: GUI;

  private storageTexture!: THREE.StorageTexture;
  private storageTextureLow!: THREE.StorageTexture;
  private textureConfig: TextureConfig = {
    size: 128,
    slicesX: 16,
    slicesY: 16,
  };
  private textureConfigLowRes: TextureConfig = {
    size: 64,
    slicesX: 16,
    slicesY: 16,
  };
  private boxSize = { x: uniform(100), y: uniform(50), z: uniform(100) };
  private cloudScale = uniform(1.0);
  private cloudOffsetX = uniform(0.0);
  private cloudOffsetY = uniform(0.0);
  private cloudOffsetZ = uniform(0.0);
  private densityMultiplier = uniform(2.0);
  private useRGBA = uniform(0.0);
  private threshold = uniform(1.52);
  private divCount = uniform(64);

  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.gui = new GUI();
    this.createNoiseTexture();
    this.createGeometry();
    this.createMaterial();
    this.createMesh();
    this.updateMaterialNode();
    this.createGUI();
    // const box = new THREE.BoxGeometry(100, 100, 100);
    // const mat = new THREE.MeshBasicNodeMaterial({
    //   color: "#fff",
    //   transparent: true,
    // });
    // mat.opacityNode = Fn(() => {
    //   const edgeWidth = float(0.2);
    //   const isXEdge = abs(positionLocal.x).greaterThan(
    //     float(100).div(2).sub(edgeWidth)
    //   );
    //   const isYEdge = abs(positionLocal.y).greaterThan(
    //     float(100).div(2).sub(edgeWidth)
    //   );
    //   const isZEdge = abs(positionLocal.z).greaterThan(
    //     float(100).div(2).sub(edgeWidth)
    //   );
    //   const edgeXY = isXEdge.and(isYEdge);
    //   const edgeXZ = isXEdge.and(isZEdge);
    //   const edgeYZ = isYEdge.and(isZEdge);
    //   const isEdge = edgeXY.or(edgeXZ).or(edgeYZ);
    //   return isEdge.select(float(1.0), float(0));
    // })();
    // const boxMesh = new THREE.Mesh(box, mat);
    // boxMesh.position.y = 35;
    // this.scene.add(boxMesh);
  }

  private createGeometry() {
    this.geometry = new THREE.BoxGeometry(
      this.boxSize.x.value,
      this.boxSize.y.value,
      this.boxSize.z.value
    );
  }

  private createMaterial() {
    this.material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
  }

  private createMesh() {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
  }

  public addToScene() {
    this.scene.add(this.mesh);
  }

  private async createNoiseTexture() {
    const { compute, storageTexture } = createNoiseTexture(
      this.textureConfig.size,
      this.textureConfig.slicesX
    );
    const { compute: computeLow, storageTexture: storageTextureLow } =
      createNoiseTexture(
        this.textureConfigLowRes.size,
        this.textureConfigLowRes.slicesX
      );
    this.storageTexture = storageTexture;
    this.storageTextureLow = storageTextureLow;
    await this.renderer.computeAsync(compute);
    await this.renderer.computeAsync(computeLow);
  }

  private updateMaterialNode() {
    const cellsX = this.textureConfig.slicesX;
    const cellsY = this.textureConfig.slicesY;
    const slices = cellsX * cellsY;

    this.material.fragmentNode = Fn(() => {
      //   let accumulatedAlpha = float(0.0).toVar();
      const color = vec4(1).toVar();
      const rayOriginWorld = cameraPosition;
      const rayDirWorld = normalize(positionWorld.sub(cameraPosition));
      //   // === Local変換 ===
      const invModel = modelWorldMatrixInverse;
      const rayOrigin = invModel.mul(vec4(rayOriginWorld, 1.0)).xyz;
      const rayDir = normalize(invModel.mul(vec4(rayDirWorld, 0.0)).xyz);
      const boxMin = vec3(
        this.boxSize.x.mul(-0.5),
        this.boxSize.y.mul(-0.5),
        this.boxSize.z.mul(-0.5)
      );
      const boxMax = vec3(
        this.boxSize.x.mul(0.5),
        this.boxSize.y.mul(0.5),
        this.boxSize.z.mul(0.5)
      );
      const invDir = vec3(1.0).div(rayDir);
      const t0 = boxMin.sub(rayOrigin).mul(invDir);
      const t1 = boxMax.sub(rayOrigin).mul(invDir);
      const tmin = min(t0, t1);
      const tmax = max(t0, t1);
      const dstA = max(max(tmin.x, tmin.y), tmin.z);
      const dstB = min(min(tmax.x, tmax.y), tmax.z);

      const dstToBox = max(0.0, dstA);
      const dstInsideBox = clamp(dstB.sub(dstToBox), 0.0, 9999.0);

      If(dstA.greaterThanEqual(dstB), () => {
        color.assign(vec4(0.0));
      });

      const steps = 64;
      const dstTraveled = float(0).toVar();
      const count = uint(0).toVar();
      const stepSize = dstInsideBox.div(float(steps));
      const totalDensity = float(0.0).toVar();
      Loop(steps, () => {
        const p = rayOrigin.add(rayDir.mul(dstToBox.add(dstTraveled)));
        const uvw = p.sub(boxMin).div(boxMax.sub(boxMin));

        //prettier-ignore
        //@ts-ignore
        const densitySample = sample3D(this.storageTexture, uvw, slices, cellsX, cellsY)
        const wfbm = densitySample.x
          .mul(0.625)
          .add(densitySample.y.mul(0.25))
          .add(densitySample.z.mul(0.125))
          .mul(this.densityMultiplier)
          .toVar();
        // const density = densitySample.mul(this.densityMultiplier);
        // const channel = this.useRGBA;
        // If(density.r.greaterThan(threshold), () => {
        //   If(channel.equal(0), () => {
        //     totalDensity.addAssign(density.r);
        //   });
        //   If(channel.equal(1), () => {
        //     totalDensity.addAssign(density.g);
        //   });
        //   If(channel.equal(2), () => {
        //     totalDensity.addAssign(density.b);
        //   });
        //   If(channel.equal(3), () => {
        //     totalDensity.addAssign(density.a);
        //   });
        // });
        If(wfbm.greaterThan(this.threshold), () => {
          totalDensity.addAssign(wfbm);
        });

        //sample density
        count.addAssign(1);
        dstTraveled.addAssign(stepSize);
      });
      const densityPerSample = totalDensity.div(this.divCount);
      // If(densityPerSample.lessThanEqual(this.threshold), () => {
      //   color.assign(vec4(0.0));
      // });
      const transmittance = exp(densityPerSample.mul(-1.0));
      return vec4(1.0).sub(color.mul(transmittance));
      // return color.mul(transmittance);
    })();
    // const sliceIndex = uniform(10);
    // this.gui.add(sliceIndex, "value", 0, 16 * 16 - 1, 1).name("Slice Index");
    // this.material.fragmentNode = Fn(() => {
    //   const uvw = vec3(uv(), sliceIndex.div(slices));
    //   //@ts-ignore
    //   const color = sample3D(this.storageTexture, uvw, slices, cellsX, cellsY);
    //   // const color = sample3D(this.storageTextureLow, uvw);
    //   const colorR = color.r;
    //   const colorG = color.g;
    //   const colorB = color.b;
    //   const colorA = color.a;
    //   const mergeColor = colorR
    //     .mul(0.5)
    //     .add(colorG.mul(0.3))
    //     .add(colorB.mul(0.2));
    //   // return vec3(1.0).sub(vec3(colorR, colorG, colorB));
    //   // return vec4(colorR, colorR, colorR, 1.0);
    //   // return vec4(colorG, colorG, colorG, 1.0);
    //   return vec4(mergeColor, mergeColor, mergeColor, 1.0);
    // })();

    this.material.transparent = true;
  }

  private createGUI() {
    this.gui
      .add(this.densityMultiplier, "value", 0.0, 4, 0.01)
      .name("Density Multiplier")
      .onChange((value: number) => {
        this.densityMultiplier.value = value;
        // this.updateMaterialNode();
      });
    // this.gui
    //   .add(this.useRGBA, "value", 0.0, 3.0, 1.0)
    //   .name("Use RGBA")
    //   .onChange((value: number) => {
    //     this.useRGBA.value = value;
    //     // this.updateMaterialNode();
    //   });
    this.gui
      .add(this.threshold, "value", 0.0, 2.0, 0.01)
      .name("Threshold")
      .onChange((value: number) => {
        this.threshold.value = value;
      });

    this.gui
      .add(this.divCount, "value", 1, 128, 1)
      .name("Div Count")
      .onChange((value: number) => {
        this.divCount.value = value;
      });
    // this.gui
    //   .add(this.cloudOffsetX, "value", 0.0, 16.0, 1.0)
    //   .name("Cloud Offset X")
    //   .onChange((value: number) => {
    //     this.cloudOffsetX.value = value;
    //   });
    // this.gui
    //   .add(this.cloudOffsetY, "value", 0.0, 16.0, 1.0)
    //   .name("Cloud Offset Y")
    //   .onChange((value: number) => {
    //     this.cloudOffsetY.value = value;
    //   });
    // this.gui
    //   .add(this.cloudOffsetZ, "value", -1.0, 1.0, 0.01)
    //   .name("Cloud Offset Z")
    //   .onChange((value: number) => {
    //     this.cloudOffsetZ.value = value;
    //   });
  }
}
