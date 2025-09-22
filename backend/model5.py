import tensorflow as tf
from tensorflow import keras
from keras import layers, models
from keras.callbacks import EarlyStopping, Callback
import json

# -------------------------
# Custom Callback to Print Accuracy in %
# -------------------------
class PercentMetrics(Callback):
    def on_epoch_end(self, epoch, logs=None):
        acc = logs.get("accuracy", 0) * 100
        val_acc = logs.get("val_accuracy", 0) * 100
        loss = logs.get("loss", 0)
        val_loss = logs.get("val_loss", 0)
        print(f"\n📊 Epoch {epoch+1}: Accuracy = {acc:.2f}%, "
              f"Val Accuracy = {val_acc:.2f}%, "
              f"Loss = {loss:.4f}, Val Loss = {val_loss:.4f}")

# -------------------------
# 1. Load Dataset
# -------------------------
train_ds_raw = tf.keras.preprocessing.image_dataset_from_directory(
    r"C:\Dont touch me !!!\GIthub\CivicFix\data\train",
    validation_split=0.2,
    subset="training",
    seed=123,
    image_size=(128, 128),
    batch_size=32
)

val_ds_raw = tf.keras.preprocessing.image_dataset_from_directory(
    r"C:\Dont touch me !!!\GIthub\CivicFix\data\train",
    validation_split=0.2,
    subset="validation",
    seed=123,
    image_size=(128, 128),
    batch_size=32
)

# ✅ Store class names before applying map/prefetch
class_names = train_ds_raw.class_names
print("Classes detected:", class_names)

# -------------------------
# 2. Normalize & Prefetch
# -------------------------
normalization_layer = layers.Rescaling(1./255)
train_ds = train_ds_raw.map(lambda x, y: (normalization_layer(x), y))
val_ds   = val_ds_raw.map(lambda x, y: (normalization_layer(x), y))

AUTOTUNE = tf.data.AUTOTUNE
train_ds = train_ds.cache().shuffle(1000).prefetch(buffer_size=AUTOTUNE)
val_ds   = val_ds.cache().prefetch(buffer_size=AUTOTUNE)

# -------------------------
# 3. Data Augmentation
# -------------------------
data_augmentation = tf.keras.Sequential([
    layers.RandomFlip("horizontal"),
    layers.RandomRotation(0.1),
    layers.RandomZoom(0.1)
])

# -------------------------
# 4. Build Model
# -------------------------
model = models.Sequential([
    layers.Input(shape=(128, 128, 3)),
    data_augmentation,

    layers.Conv2D(32, (3,3), activation='relu'),
    layers.MaxPooling2D(),

    layers.Conv2D(64, (3,3), activation='relu'),
    layers.MaxPooling2D(),

    layers.Conv2D(128, (3,3), activation='relu'),
    layers.MaxPooling2D(),

    layers.Flatten(),
    layers.Dense(128, activation='relu', 
                 kernel_regularizer=tf.keras.regularizers.l2(0.001)),
    layers.Dropout(0.5),
    layers.Dense(len(class_names), activation='softmax')
])

# -------------------------
# 5. Compile Model
# -------------------------
model.compile(
    optimizer='adam',
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

# -------------------------
# 6. Train Model
# -------------------------
early_stop = EarlyStopping(monitor="val_loss", patience=3, restore_best_weights=True)

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=6,
    callbacks=[early_stop, PercentMetrics()]
)

# -------------------------
# 7. Save Model & Class Names
# -------------------------
MODEL_PATH = "civicfix_model4.h5"
model.save(MODEL_PATH)

with open("class_names.json", "w") as f:
    json.dump(class_names, f)

print(f"✅ Training complete. Model saved as {MODEL_PATH}")
print("✅ Class names saved as class_names.json")
