FROM nikolaik/python-nodejs

WORKDIR /usr/src/app

# Install Nginx
RUN apt-get update && apt-get install nginx -y
COPY nginx.conf /etc/nginx/sites-enabled/default
RUN service nginx start

RUN apt-get install -y --no-install-recommends apt-utils
RUN apt-get -y upgrade

RUN git clone --depth 1 https://github.com/tensorflow/models.git

RUN apt-get install -y protobuf-compiler python-pil python-lxml python-tk && \
    pip install Cython && \
    pip install contextlib2 && \
    pip install jupyter && \
    pip install matplotlib && \
    pip install pycocotools && \
    pip install opencv-python && \
    pip install flask && \
    pip install tensorflow && \
    pip install Pillow && \
    pip install requests

RUN curl -OL "https://github.com/google/protobuf/releases/download/v3.0.0/protoc-3.0.0-linux-x86_64.zip" && \
    unzip protoc-3.0.0-linux-x86_64.zip -d proto3 && \
    mv proto3/bin/* /usr/local/bin && \
    mv proto3/include/* /usr/local/include && \
    rm -rf proto3 protoc-3.0.0-linux-x86_64.zip

# Run protoc on the object detection repo
RUN cd models/research && \
    protoc object_detection/protos/*.proto --python_out=.

# Set the PYTHONPATH to finish installing the API
ENV PYTHONPATH=$PYTHONPATH:/models/research/object_detection
ENV PYTHONPATH=$PYTHONPATH:/models/research/slim
ENV PYTHONPATH=$PYTHONPATH:/models/research

# download the pretrained model
# change here to download your pretrained model
RUN cd models/ && \
    curl -O "http://download.tensorflow.org/models/object_detection/ssd_mobilenet_v1_fpn_shared_box_predictor_640x640_coco14_sync_2018_07_03.tar.gz" && \
    tar xzf ssd_mobilenet_v1_fpn_shared_box_predictor_640x640_coco14_sync_2018_07_03.tar.gz && \
    rm ssd_mobilenet_v1_fpn_shared_box_predictor_640x640_coco14_sync_2018_07_03.tar.gz


RUN apt-get install cmake -y
RUN pip install Image
RUN pip install face_recognition
RUN pip install python-dotenv
RUN pip install Flask
RUN pip install requests

RUN cp -r /usr/src/app/models/research/object_detection/ /usr/src/app/

COPY package.json .
RUN npm install

COPY . .

CMD [ "sh", "run.sh" ]
