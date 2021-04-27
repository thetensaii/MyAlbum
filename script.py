# cd Documents\E4\_ProjetAnnuel\object_detection\models\research\object_detection

from PIL import Image
import face_recognition
import os
import uuid
import time
import json
from threading import Thread
from flask import Flask, escape, request, jsonify
from dotenv import load_dotenv
import requests
import tensorflow as tf
import obj_detection
import pprint

from object_detection.utils import ops as utils_ops
from object_detection.utils import label_map_util
from object_detection.utils import visualization_utils as vis_util

load_dotenv()

# Chemin des images
path = os.getenv("IMAGES_DIR")

# Chemin des faces (permettent la comparaisons)
faces_path = os.getenv("FACES_DIR")

datas = {
    "image_id" : "Bill-Gates",
    "user_id" : 23,
    "faces_to_compare" : [
        # {
        #     "face_id" : "Bil",
        #     "tag_id" : "Bill"
        # },
        # {
        #     "face_id" : "Lebron",
        #     "tag_id" : "dmd"
        # },
        # {
        #     "face_id" : "Steve",
        #     "tag_id" : "Bwdill"
        # }
    ]
}


def recognize_faces(datas):
    """
    Fonction qui va permettre pour une image de reconnaître et d'enregistrer chaque faces présentent dans celle-ci.
    """
    # Initialisation de la variable de retour
    struct = {
        "image_id" : datas["image_id"],
        "user_id" : datas["user_id"],
        "faces_detected" : []
    }
    image_path = path + datas["image_id"] + ".jpg"

    # On enregiste dans 2 tableaux différents les labels ainsi que la signature correspondants aux faces enregistrées
    faces_tags = []
    faces_encoding = []
    for face in datas["faces_to_compare"]:
        print(face)
        faces_tags.append(face["tag_id"])
        faces_encoding.append(
            face_recognition.face_encodings(
                face_recognition.load_image_file(os.path.join(faces_path, face["detection_id"] + ".jpg"))
            )[0]
        )


    all_tags = list(set(faces_tags))

    # On récupère la localisation ainsi que la signature de toutes les faces detecter sur l'image
    image = face_recognition.load_image_file(image_path)
    face_locations = face_recognition.face_locations(image)
    face_encodings = face_recognition.face_encodings(image, face_locations)


    for (top, right, bottom, left), face_encoding in zip(face_locations, face_encodings) :
        face_detected = {
            "face_id" : str(uuid.uuid4()),
            "position":{
                "from_x": left,
                "from_y": top,
                "to_x": right,
                "to_y": bottom
            },
            "tag_id" : "NULL",
            "percentage" : 0
        }

        # On enregistre la face
        face_image = image[top:bottom, left:right]
        new_face = Image.fromarray(face_image)
        new_face.save(faces_path + face_detected["face_id"] + ".jpg")

        # Si aucune face n'est enregistrée pour l'utilisateur qui enregistre l'image
        # Nous n'avons pas de comparaison à faire donc on enregistre seulement la face
        if(len(faces_encoding) == 0):
            
            struct["faces_detected"].append(face_detected)
            continue

        # Initialisation du dictionnaire des distances par tags
        results_by_tags = {}
        for tag in all_tags:
            results_by_tags[tag] = {
                "distances" : [],
                "percentage" : 0
            }

        # Calcul des distances moyennes afin d'obtenir des pourcentages de certitudes
        # Pour la ressemblance en fonction des différents tags
        distances = face_recognition.face_distance(faces_encoding, face_encoding)
        for i in range(len(distances)):
            results_by_tags[faces_tags[i]]["distances"].append(distances[i])

        for tag in all_tags:
            sum_distances = 0
            for d in results_by_tags[tag]["distances"] :
                sum_distances += d

            results_by_tags[tag]["percentage"] = 1 - (sum_distances / len(results_by_tags[tag]["distances"]))

        avg_percentage = []
        for tag in all_tags:
            avg_percentage.append(results_by_tags[tag]["percentage"])

        # On prend la certitude la plus importante
        # Si le pourcentage est assez important on défini la face appertenant à ce tag
        index_max = avg_percentage.index(max(avg_percentage))
        if avg_percentage[index_max] >= 0.5:
            face_detected["tag_id"] = all_tags[index_max]
            face_detected["percentage"] = avg_percentage[index_max]

        # On met la face dans les faces detectées concernant l'image
        struct["faces_detected"].append(face_detected)

    return struct



app = Flask(__name__)
images_queue = []

# PATCHES
# patch tf1 into `utils.ops`
utils_ops.tf = tf.compat.v1
# Patch the location of gfile
tf.gfile = tf.io.gfile

# List of the strings that is used to add correct label for each box.
PATH_TO_LABELS = 'object_detection/data/mscoco_label_map.pbtxt'
category_index = label_map_util.create_category_index_from_labelmap(PATH_TO_LABELS, use_display_name=True)

# Load an object detection model
model_name = 'ssd_mobilenet_v1_coco_2017_11_17'
detection_model = obj_detection.load_model(model_name)

print(os.getenv("NODEJS_URL"))

@app.route('/api/entry', methods= ["POST"])
def entry():
    datas = request.json
    images_queue.append(datas)
    # result = recognize_faces(datas)
    # result["objects_detected"] = obj_detection.detect_objects(detection_model, category_index, datas)
    # return jsonify(result)
    return ""

def startServer():
    app.run(host=os.getenv("PYTHON_HOST"), port=os.getenv("PYTHON_PORT"))

class Worker(Thread):
	def __init__(self):
		Thread.__init__(self)
	def run(self):
		while(True):
			print("size : ",len(images_queue))
			if(len(images_queue) > 0):
				d = images_queue.pop(0)
				result = recognize_faces(d)
				result["objects_detected"] = obj_detection.detect_objects(detection_model, category_index, d)
				stringify_result = json.dumps(result)
				print("result",result)
				requests.post(os.getenv("NODEJS_URL"), data=stringify_result, headers={'content-type': 'application/json'})
			time.sleep(1)

worker = Worker()
worker.start()
startServer()

