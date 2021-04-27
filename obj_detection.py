# IMPORTS
import numpy as np
import os
import pathlib
import six.moves.urllib as urllib
import sys
import tarfile
import tensorflow as tf
import zipfile
import pprint

from collections import defaultdict
from io import StringIO
from matplotlib import pyplot as plt
from PIL import Image, ImageDraw
from dotenv import load_dotenv

# Import the object detection module
from object_detection.utils import ops as utils_ops
from object_detection.utils import label_map_util
from object_detection.utils import visualization_utils as vis_util

load_dotenv()
path = os.getenv("IMAGES_DIR")

def load_model(model_name):
    """
    Permet de charger un modèle de detection d'objet.
    Les objets detectables sont enregistrés dans ce modèle.
    """
    base_url = 'http://download.tensorflow.org/models/object_detection/'
    model_file = model_name + '.tar.gz'
    model_dir = tf.keras.utils.get_file(
        fname=model_name, 
        origin=base_url + model_file,
        untar=True)

    model_dir = pathlib.Path(model_dir)/"saved_model"

    model = tf.saved_model.load(str(model_dir))
    model = model.signatures['serving_default']

    return model

def run_inference_for_single_image(model, image):
    """
    Fonction permettant pour l'image d'avoir tous les objets detectables par le modèle.
    """
    image = np.asarray(image)
    # The input needs to be a tensor, convert it using `tf.convert_to_tensor`.
    input_tensor = tf.convert_to_tensor(image)
    # The model expects a batch of images, so add an axis with `tf.newaxis`.
    input_tensor = input_tensor[tf.newaxis,...]

    # Run inference
    output_dict = model(input_tensor)

    # All outputs are batches tensors.
    # Convert to numpy arrays, and take index [0] to remove the batch dimension.
    # We're only interested in the first num_detections.
    num_detections = int(output_dict.pop('num_detections'))
    output_dict = {key:value[0, :num_detections].numpy() 
                    for key,value in output_dict.items()}
    output_dict['num_detections'] = num_detections

    # detection_classes should be ints.
    output_dict['detection_classes'] = output_dict['detection_classes'].astype(np.int64)
    
    # Handle models with masks:
    if 'detection_masks' in output_dict:
        # Reframe the the bbox mask to the image size.
        detection_masks_reframed = utils_ops.reframe_box_masks_to_image_masks(
                output_dict['detection_masks'], output_dict['detection_boxes'],
                image.shape[0], image.shape[1])      
        detection_masks_reframed = tf.cast(detection_masks_reframed > 0.5,
                                        tf.uint8)
        output_dict['detection_masks_reframed'] = detection_masks_reframed.numpy()
        
    return output_dict

def show_inference(model, category_index, image_path):
    """
    Fonction qui retourne le type et les coordonnées de chaque objets detectés dans l'image.
    """
    # the array based representation of the image will be used later in order to prepare the
    # result image with boxes and labels on it.
    image = Image.open(image_path)
    image_np = np.array(image)
    # image_draw = ImageDraw.Draw(image)

    objects_detected  = []

    # Actual detection.
    output_dict = run_inference_for_single_image(model, image_np)
    scores = output_dict['detection_scores']
    classes = output_dict['detection_classes']
    boxes = output_dict['detection_boxes']

    (width, height) = image.size
    tolerance = 0.4
    for i in range(len(scores)):
        if scores[i] >= tolerance :
            
            name = category_index[classes[i]]["name"]
            (from_y, from_x, to_y, to_x) = boxes[i]
            from_y *= height
            to_y *= height
            from_x *= width
            to_x *= width

            obj = {
                "position" : {
                    "from_x" : from_x,
                    "from_y" : from_y,
                    "to_x" : to_x,
                    "to_y" : to_y
                },
                "tag_id" : name
            }

            # image_draw.rectangle(((from_x, from_y) , (to_x, to_y)) , outline=(255,0,0))
            objects_detected.append(obj)

    # image.show()

    return objects_detected

def detect_objects(detection_model, category_index, datas):
    """
    Seule fonction appelée directement pour la detection d'objets
    """
    image_path = path + datas["image_id"] + ".jpg"
    # pp = pprint.PrettyPrinter(indent=2)
    objects_detected = show_inference(detection_model, category_index, image_path)
    # pp.pprint(objects_detected)
    return objects_detected
