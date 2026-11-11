import os
import shutil
import sys
import yaml
from pathlib import Path
from ultralytics import YOLO

DOWNLOADS_DIR = Path(r"C:\Users\kandi\Downloads")
DATASET_FOLDERS = [
    DOWNLOADS_DIR / "Signage.v15i.yolov8",
    DOWNLOADS_DIR / "Transport pictograms.v18i.yolov8",
    DOWNLOADS_DIR / "iso.v1-isolation-pile.yolov8",
    DOWNLOADS_DIR / "Indoor Navigation.v1i.yolov8"
]

TARGET_DIR = Path(r"C:\Users\kandi\Desktop\my projects\blindvoice\dataset_merged")

def merge_datasets():
    print("--- Starting Dataset Consolidation ---")
    for split in ['train', 'val']:
        (TARGET_DIR / split / 'images').mkdir(parents=True, exist_ok=True)
        (TARGET_DIR / split / 'labels').mkdir(parents=True, exist_ok=True)

    master_classes = []
    class_map_per_dataset = []

    for ds_path in DATASET_FOLDERS:
        yaml_file = ds_path / "data.yaml"
        if not yaml_file.exists():
            print(f"Skipping missing dataset folder: {ds_path}")
            class_map_per_dataset.append({})
            continue

        with open(yaml_file, 'r') as f:
            data = yaml.safe_load(f)

        raw_names = data.get('names', [])
        if isinstance(raw_names, dict):
            raw_names = [raw_names[k] for k in sorted(raw_names.keys())]

        ds_mapping = {}
        for local_id, name in enumerate(raw_names):
            clean_name = str(name).strip().lower().replace(" ", "_")
            if clean_name not in master_classes:
                master_classes.append(clean_name)
            ds_mapping[local_id] = master_classes.index(clean_name)
        
        class_map_per_dataset.append(ds_mapping)

    print(f"Unified Master Classes ({len(master_classes)} classes total):")
    for idx, cname in enumerate(master_classes):
        print(f"  [{idx}]: {cname}")

    img_counter = 0
    for ds_idx, ds_path in enumerate(DATASET_FOLDERS):
        mapping = class_map_per_dataset[ds_idx]
        if not mapping:
            continue

        splits_to_check = [('train', 'train'), ('valid', 'val'), ('test', 'val')]
        for src_split, target_split in splits_to_check:
            img_dir = ds_path / src_split / "images"
            lbl_dir = ds_path / src_split / "labels"

            if not img_dir.exists():
                continue

            for img_file in img_dir.glob("*.*"):
                if img_file.suffix.lower() not in ['.jpg', '.jpeg', '.png']:
                    continue

                img_counter += 1
                new_basename = f"img_{img_counter:05d}{img_file.suffix}"
                shutil.copy(img_file, TARGET_DIR / target_split / 'images' / new_basename)

                lbl_file = lbl_dir / f"{img_file.stem}.txt"
                target_lbl = TARGET_DIR / target_split / 'labels' / f"img_{img_counter:05d}.txt"

                if lbl_file.exists():
                    new_lines = []
                    with open(lbl_file, 'r') as lf:
                        for line in lf:
                            parts = line.strip().split()
                            if not parts:
                                continue
                            old_cls = int(parts[0])
                            if old_cls in mapping:
                                new_cls = mapping[old_cls]
                                new_lines.append(f"{new_cls} " + " ".join(parts[1:]))

                    with open(target_lbl, 'w') as tlf:
                        tlf.write("\n".join(new_lines))
                else:
                    target_lbl.touch()

    yaml_content = {
        'path': str(TARGET_DIR.resolve()).replace("\\", "/"),
        'train': 'train/images',
        'val': 'val/images',
        'nc': len(master_classes),
        'names': master_classes
    }

    master_yaml_path = Path(r"C:\Users\kandi\Desktop\my projects\blindvoice\indoor_amenities.yaml")
    with open(master_yaml_path, 'w') as f:
        yaml.dump(yaml_content, f, sort_keys=False)

    print(f"\nSuccessfully consolidated dataset into {TARGET_DIR}")

def start_training():
    print("\n--- Starting Transfer Learning ---")
    yaml_path = r"C:\Users\kandi\Desktop\my projects\blindvoice\indoor_amenities.yaml"
    # Fine-tune from the best completed run (highest mAP50-95), not a hardcoded folder
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from best_run import find_best_run
    found = find_best_run()
    if found:
        model_weights = str(found[0])
        print(f"Starting from best run '{found[2]}' (mAP50-95 = {found[1]:.4f})")
    else:
        model_weights = 'yolov8n.pt'
        print("No completed run found; starting from yolov8n.pt")

    model = YOLO(model_weights)
    model.train(data=yaml_path, epochs=25, imgsz=640, batch=16, device='cpu')

if __name__ == '__main__':
    merge_datasets()
    start_training()
