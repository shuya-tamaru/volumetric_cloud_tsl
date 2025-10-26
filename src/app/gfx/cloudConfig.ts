import { color, uniform } from "three/tsl";

export interface TextureConfig {
  size: number;
}
export class CloudConfig {
  //geometry
  public boxSize = { x: uniform(100), y: uniform(100), z: uniform(100) };
  public cloudScale = uniform(1.0);
  public cloudOffsetX = uniform(0.0);
  public cloudOffsetY = uniform(0.0);
  public cloudOffsetZ = uniform(0.0);
  public densityScale = uniform(2.0);
  public cloudVisibilityThreshold = uniform(1.52);
  public intensity = uniform(64);

  public textureSlice = { x: uniform(16), y: uniform(16) };
  public textureSize = 128;
  public textureFrequencies = {
    freq1: uniform(2.0),
    freq2: uniform(8.0),
    freq3: uniform(20.0),
    freq4: uniform(1.0),
  };

  public cloudColor = uniform(color("#000"));
}
