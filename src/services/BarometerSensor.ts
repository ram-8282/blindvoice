export type ElevationCallback = (deltaH: number, direction: 'UP' | 'DOWN' | 'NONE') => void;

export class BarometerSensor {
  private baselinePressure: number | null = null;
  private readonly R = 8.3144; // Universal gas constant
  private readonly g = 9.80665; // Gravity
  private readonly M = 0.0289644; // Molar mass of Earth's air
  private readonly T = 288.15; // Standard temperature (K)

  public setBaselinePressure(pressureHPa: number): void {
    this.baselinePressure = pressureHPa;
  }

  public processPressureReading(currentPressureHPa: number): {
    deltaH: number;
    levelChangeDetected: boolean;
    direction: 'UP' | 'DOWN' | 'NONE';
  } {
    if (!this.baselinePressure) {
      this.baselinePressure = currentPressureHPa;
      return { deltaH: 0, levelChangeDetected: false, direction: 'NONE' };
    }

    // Barometric height formula: Δh = -(R*T / (g*M)) * ln(P_current / P_baseline)
    const deltaH = -((this.R * this.T) / (this.g * this.M)) * Math.log(currentPressureHPa / this.baselinePressure);

    let direction: 'UP' | 'DOWN' | 'NONE' = 'NONE';
    let levelChangeDetected = false;

    if (deltaH >= 3.8) {
      direction = 'UP';
      levelChangeDetected = true;
    } else if (deltaH <= -3.8) {
      direction = 'DOWN';
      levelChangeDetected = true;
    }

    return {
      deltaH: parseFloat(deltaH.toFixed(2)),
      levelChangeDetected,
      direction,
    };
  }
}

