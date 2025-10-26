import {
  vec3,
  float,
  Fn,
  vec4,
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
} from "three/tsl";
import * as THREE from "three/webgpu";
import { createNoiseTexture } from "./utils/createNoiseTexture";
import { sample3D } from "./utils/sample3D";
import type { CloudConfig } from "./cloudConfig";

export class Cloud {
  private scene: THREE.Scene;
  private renderer!: THREE.WebGPURenderer;

  private geometry!: THREE.PlaneGeometry;
  private material!: THREE.MeshBasicNodeMaterial;
  private mesh!: THREE.Mesh;

  private cloudConfig!: CloudConfig;

  private storageTexture!: THREE.StorageTexture;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGPURenderer,
    cloudConfig: CloudConfig
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.cloudConfig = cloudConfig;
    this.computeNoiseTexture();
    this.createGeometry();
    this.createMaterial();
    this.createMesh();
    this.updateMaterialNode();
  }

  private createGeometry() {
    this.geometry = new THREE.BoxGeometry(
      this.cloudConfig.boxSize.x.value,
      this.cloudConfig.boxSize.y.value,
      this.cloudConfig.boxSize.z.value
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

  private async computeNoiseTexture() {
    const { textureSize, textureSlice, textureFrequencies } = this.cloudConfig;
    const { compute, storageTexture } = createNoiseTexture(
      textureSize,
      textureSlice.x.value,
      textureFrequencies
    );

    this.storageTexture = storageTexture;
    await this.renderer.computeAsync(compute);
  }

  private updateMaterialNode() {
    const {
      boxSize,
      densityScale,
      cloudVisibilityThreshold,
      intensity,
      textureSlice,
      cloudColor,
    } = this.cloudConfig;
    const cellsX = textureSlice.x.value;
    const cellsY = textureSlice.y.value;
    const slices = cellsX * cellsY;

    this.material.fragmentNode = Fn(() => {
      const color = vec4(cloudColor, 1.0).toVar();
      const rayOriginWorld = cameraPosition;
      const rayDirWorld = normalize(positionWorld.sub(cameraPosition));

      const invModel = modelWorldMatrixInverse;
      const rayOrigin = invModel.mul(vec4(rayOriginWorld, 1.0)).xyz;
      const rayDir = normalize(invModel.mul(vec4(rayDirWorld, 0.0)).xyz);
      const boxMin = vec3(
        boxSize.x.mul(-0.5),
        boxSize.y.mul(-0.5),
        boxSize.z.mul(-0.5)
      );
      const boxMax = vec3(
        boxSize.x.mul(0.5),
        boxSize.y.mul(0.5),
        boxSize.z.mul(0.5)
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
          .mul(densityScale)
          .toVar();

        If(wfbm.greaterThan(cloudVisibilityThreshold), () => {
          totalDensity.addAssign(wfbm);
        });

        //sample density
        count.addAssign(1);
        dstTraveled.addAssign(stepSize);
      });
      const densityPerSample = totalDensity.div(intensity);
      // If(densityPerSample.lessThanEqual(this.threshold), () => {
      //   color.assign(vec4(0.0));
      // });
      const transmittance = exp(densityPerSample.mul(-1.0));
      return vec4(1.0).sub(color.mul(transmittance));
    })();
    this.material.transparent = true;
  }

  public updateCloudBoundaryBox() {
    this.geometry.dispose();
    this.mesh.geometry.dispose();
    this.geometry = new THREE.BoxGeometry(
      this.cloudConfig.boxSize.x.value,
      this.cloudConfig.boxSize.y.value,
      this.cloudConfig.boxSize.z.value
    );
    // this.createGeometry();
    this.mesh.geometry = this.geometry;
    this.updateMaterialNode();
  }

  public async updateTextureParameters() {
    await this.computeNoiseTexture();

    this.material.dispose();
    this.material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    this.mesh.material = this.material;

    this.updateMaterialNode();
  }
}
