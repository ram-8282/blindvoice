from pathlib import Path
import torch
from ultralytics import YOLO

def train_and_export():
    print("Initializing YOLOv8-Nano Transfer Learning Pipeline...")
    
    # Load base weights
    model = YOLO('yolov8n.pt')
    
    device_to_use = 0 if torch.cuda.is_available() else 'cpu'
    print(f"Training using device: {device_to_use}")
    
    # Locate YAML relative to this script's current directory
    script_dir = Path(__file__).resolve().parent
    yaml_path = str(script_dir / 'indoor_amenities.yaml')
    print(f"Validated YAML Path: {yaml_path}")
    
    # Run training
    model.train(
        data=yaml_path,
        epochs=10,
        imgsz=640,
        batch=16,
        device=device_to_use
    )
    
    print("Training Complete. Exporting TFLite model...")
    model.export(format='tflite', int8=True, data=yaml_path)
    print("Export Complete!")

if __name__ == '__main__':
    train_and_export()