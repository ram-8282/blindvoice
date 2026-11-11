import { IndoorNavigationEngine, VenueGraph } from '../services/IndoorNavigationEngine';
import sfoGraph from '../assets/graphs/sfo_terminal_2.json';

describe('IndoorNavigationEngine Dead-Reckoning Suite', () => {
  let engine: IndoorNavigationEngine;

  beforeEach(() => {
    engine = new IndoorNavigationEngine(0.70);
    engine.loadGraph(sfoGraph as VenueGraph);
  });

  test('should initialize at Security Checkpoint B Exit', () => {
    const status = engine.processStep(0);
    expect(status.remainingSteps).toBe(36);
    expect(status.voiceInstruction).toContain('Continue straight ahead');
  });

  test('should advance to segment 1 after 36 steps', () => {
    const status = engine.processStep(36);
    expect(status.remainingSteps).toBe(24);
    expect(status.voiceInstruction).toContain('Turn 90 degrees left');
  });

  test('should require barometric verification on escalator segment', () => {
    engine.processStep(36); // Segment 0 complete
    engine.processStep(24); // Segment 1 complete
    const status = engine.processStep(18); // Reaches escalator
    
    expect(status.voiceInstruction).toContain('take the escalator');
    
    // Simulate altimeter height update
    engine.handleElevationComplete();
    const nextStatus = engine.processStep(1);
    expect(nextStatus.remainingSteps).toBe(31);
  });
});
