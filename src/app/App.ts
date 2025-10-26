import { CameraManager } from "./core/CameraManager";
import { ControlsManager } from "./core/ControlManager";
import { RendererManager } from "./core/RendererManager";
import { SceneManager } from "./core/SceneManager";
import { GfxConfig } from "./gfx/gfxConfig";
import * as THREE from "three/webgpu";
import { ParamsControls } from "./utils/ParamsControls";
import { Cloud } from "./gfx/Cloud";

export class App {
  private sceneManager!: SceneManager;
  private cameraManager!: CameraManager;
  private rendererManager!: RendererManager;
  private controlsManager!: ControlsManager;

  private animationId?: number;

  private width: number;
  private height: number;
  private aspect: number;

  private cloud!: Cloud;

  constructor() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.aspect = this.width / this.height;

    this.initApp();
  }

  private initApp() {
    this.initializeInstances();
    this.addObjectsToScene();
    this.setupEventListeners();
    this.startAnimation();
  }

  private initializeInstances() {
    this.sceneManager = new SceneManager();
    this.cameraManager = new CameraManager(this.aspect);
    this.rendererManager = new RendererManager(this.width, this.height);
    this.controlsManager = new ControlsManager(
      this.cameraManager.camera,
      this.rendererManager.renderer.domElement
    );
    this.cloud = new Cloud(
      this.sceneManager.scene,
      this.rendererManager.renderer
    );
    // this.gfxConfig = new GfxConfig();

    // new ParamsControls(this.gfxConfig, this.terrain);
  }

  private addObjectsToScene(): void {
    this.cloud.addToScene();
  }

  private handleResize = (): void => {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.aspect = this.width / this.height;
    this.cameraManager.updateAspect(this.aspect);
    this.rendererManager.resize(this.width, this.height);
  };

  private setupEventListeners(): void {
    window.addEventListener("resize", this.handleResize);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controlsManager.update();
    this.rendererManager.render(
      this.sceneManager.scene,
      this.cameraManager.camera
    );
  };

  private startAnimation(): void {
    this.animate();
  }

  public cleanup(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    window.removeEventListener("resize", this.handleResize);
  }
}
