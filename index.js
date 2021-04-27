var express = require("express");
const fileUpload = require('express-fileupload');
var fs = require('fs');
const uuidv4 = require('uuid/v4');
var randomstring = require('randomstring');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require("request");
var thumb = require('node-thumbnail').thumb;
var sqlite3 = require('sqlite3').verbose();
var PImage = require('pureimage');

//Loading environment config
const dotenv = require('dotenv');
dotenv.config();

var db = new sqlite3.Database(process.env.DATABASE_PATH);

db.serialize(function () {
    db.run("CREATE TABLE users(user_id INTEGER PRIMARY KEY AUTOINCREMENT, firstname TEXT, lastname TEXT, username TEXT, UNIQUE(username));", (err) => console.log(err));
    db.run("CREATE TABLE session(token VARCHAR(128), user_id int, expire DATETIME);", (err) => console.log(err));
    db.run("CREATE TABLE images(user_id int, image_id TEXT, treat BOOL);", (err) => console.log(err));
    db.run("CREATE TABLE detection(detection_id int auto_increment, image_id TEXT, from_x int, from_y int, to_x int, to_y int, percentage int, tag_id int, type TEXT);", (err) => console.log(err))
    db.run("CREATE TABLE link(image_id TEXT,tag_id int);", (err) => console.log(err))
    db.run("CREATE TABLE tags(tag_id INTEGER PRIMARY KEY AUTOINCREMENT, tag_title TEXT, UNIQUE(tag_title));", (err) => console.log(err));
})
fs.mkdir(process.env.THUMBS_DIR, (err) => console.log(err));
fs.mkdir(process.env.IMAGES_DIR, (err) => console.log(err));
fs.mkdir(process.env.FACES_DIR, (err) => console.log(err));
fs.mkdir(process.env.TEMP_DIR, (err) => console.log(err));

var app = new express();
app.use((req, res, next) => {
    console.log(req.method+" "+req.path);
    next();
})
app.use(cookieParser());
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json());

app.post("/api/register", (req, res) => {
    var firstname = req.body.firstname;
    var lastname = req.body.lastname;
    var username = req.body.username;
    db.run("INSERT INTO users(firstname,lastname,username) VALUES(?,?,?);", [firstname, lastname, username], (err) => {
        if (err) {
            console.log(err)
            res.status(500).json({});
        } else {
            res.status(200).json({})
        }
    })
})

app.post("/api/login", (req, res) => {
    var username = req.body.username;
    db.all("SELECT * FROM users WHERE username = ?;", [username], (err, rows) => {
        if (rows.length > 0) {
            var expire = new Date(new Date().getTime() + 604800000);
            var token = randomstring.generate(128);

            db.run("INSERT INTO session(token,user_id) VALUES(?,?);", [token, rows[0].user_id], (err, rows) => {
                if (err) {
                    res.status(500).json({});
                } else {
                    res.cookie('session_token', token, {
                        expire: expire
                    }).send({});
                }
            })
        } else {
            res.status(401).json({})
        }
    })
});

app.get("/api/checkSession", checkSession, (req, res) => {
    res.status(200).json(req.data);
});

app.use("/api/upload", checkSession, fileUpload({
    limits: {fileSize: 6 * 1024 * 1024},
}), (req, res) => {
    var uuid = uuidv4();
    console.log(req.files);
    req.files.file.mv(process.env.IMAGES_DIR + uuid + ".jpg", function (err) {
        if (err) {
            res.status(500).json({});
            console.log("Internal Error: " + err);
        } else {
            thumb({
                prefix: '',
                suffix: '',
                source: process.env.IMAGES_DIR + uuid + '.jpg',
                destination: process.env.THUMBS_DIR,
                concurrency: 1,
                width: 200
            }, function (files, err, stdout, stderr) {
                console.log('All done!');
            });
            db.run("INSERT INTO images(user_id,image_id,treat) VALUES(?,?,?);", [req.data.user_id, uuid, false], (err, rows) => {
                if (err) {
                    console.log(err);
                    res.status(500).json({});
                } else {
                    res.status(200).json({});
                    makeFaceRecognition(req.data.user_id, uuid);
                }
            })
        }
    })
});

app.get("/api/images", checkSession, (req, res) => {
    db.all("SELECT images.image_id,tags.tag_title,tags.tag_id FROM images LEFT JOIN link ON images.image_id = link.image_id LEFT JOIN tags ON tags.tag_id = link.tag_id WHERE user_id = ?;", [req.data.user_id], (err, rows) => {
        if (err) {
            console.log(err)
            res.status(500).json({})
        } else {
            var image_compiled = {}
            rows.map((obj)=>{
                if(image_compiled[obj.image_id]==null)
                    image_compiled[obj.image_id] = []
                image_compiled[obj.image_id].push({tag_title:obj.tag_title,tag_id:obj.tag_id});
            });
            var images = Object.keys(image_compiled).map((key)=>{
                console.log(key);
                return {src:key,tags:image_compiled[key]};
            })
            res.status(200).json(images);
        }
    });
})

app.get("/api/images/research", checkSession, (req, res) => {
    console.log(req.query)
    db.all("SELECT images.image_id,tags.tag_title,tags.tag_id FROM detection LEFT JOIN images ON detection.image_id = images.image_id LEFT JOIN tags ON tags.tag_id = detection.tag_id WHERE images.user_id = ?;", [req.data.user_id], (err, rows) => {
        if (err) {
            console.log(err)
            res.status(500).json({})
        } else {
            var image_compiled = {}
            rows.map((obj)=>{
                if(image_compiled[obj.image_id]==null)
                    image_compiled[obj.image_id] = []
                image_compiled[obj.image_id].push({tag_title:obj.tag_title,tag_id:obj.tag_id});
            });
	    console.log(image_compiled);
	    Object.keys(image_compiled).map(function(key,index){
		console.log(image_compiled[key]);
		var el = image_compiled[key].find(a => {
			return a.tag_title.includes(req.query.query);
		})
		console.log(el);
		if(!el)
		    delete image_compiled[key];
	    })
            var images = Object.keys(image_compiled).map((key)=>{
                console.log(key);
                return {src:key,tags:image_compiled[key]};
            })
            res.status(200).json(images);
        }
    });
})

app.post("/api/removeImage", checkSession, (req, res) => {
	console.log(req.body);
    var image_id = req.body.image_id;
    db.run("DELETE FROM images WHERE image_id = ?;", [image_id], (err, rows) => {
        if (err) {
            console.log(err)
            res.status(500).json({})
        } else {
            fs.unlink(process.env.IMAGES_DIR + image_id + ".jpg", (err) => {
                if (err) console.log(err)
            });
            fs.unlink(process.env.THUMBS_DIR + image_id + ".jpg", (err) => {
                if (err) console.log(err)
            });
            res.status(200).json({});
        }
    });
})


app.get("/api/image/:id", checkSession, (req, res) => {
    var id = req.params.id;
    res.sendFile(process.env.IMAGES_DIR + id + ".jpg");
})

app.get("/api/image/:id/info", checkSession, (req, res) => {
    var id = req.params.id;
    db.all("SELECT * FROM detection LEFT JOIN tags ON tags.tag_id = detection.tag_id WHERE detection.image_id = ?;", [id], (err, rows) => {
        if (err) {
            console.log(err)
            res.status(500).json({})
        } else {
			console.log(rows);
            res.status(200).json({
				detection: rows
			});
        }
    });
})

app.get("/api/image/:id/compile", checkSession, (req, res) => {
    var id = req.params.id;
    PImage.decodeJPEGFromStream(fs.createReadStream(process.env.IMAGES_DIR + id + ".jpg")).then((img) => {
        console.log("size is",img.width,img.height);
        var ctx = img.getContext('2d');
        ctx.fillStyle = 'rgba(255,0,0, 0.5)';
        ctx.fillRect(0,0,100,100);
        PImage.encodeJPEGToStream(img,fs.createWriteStream(process.env.TEMP_DIR+id+".jpg")).then(() => {
            console.log("done writing");
            res.sendFile(process.env.TEMP_DIR + id + ".jpg");
        });
    })
})

app.get("/api/thumb/:id", checkSession, (req, res) => {
    var id = req.params.id;
    res.sendFile(process.env.THUMBS_DIR + id + ".jpg");
})

app.use("/api/callback", (req, res) => {
	res.status(200).json({});
	console.log(req.body);
	req.body.faces_detected.map((face_detected)=>{
    	var data = [
		face_detected.face_id,
		face_detected.position.from_x,
		face_detected.position.from_y,
		face_detected.position.to_x,
		face_detected.position.to_y,
		face_detected.percentage,
		req.body.image_id];
		db.run('INSERT INTO tags(tag_title) VALUES(?);',[face_detected.tag_id],(err,row)=>{
			db.all("SELECT * FROM tags WHERE tag_title = ?;",[face_detected.tag_id],(err,row)=>{
				if(row.length>0){
					data.push(row[0].tag_id);
					console.log(data);
					db.run('INSERT INTO detection(detection_id,from_x,from_y,to_x,to_y,percentage,image_id,type,tag_id) VALUES(?,?,?,?,?,?,?,"face",?);',data,(err)=>{
						if(err)
							console.log(err);
					})
				}else{
					console.log("NOT WORKING AT ALL")
				}
			})
		})
	});
	req.body.objects_detected.map((object_detected)=>{
    	var data = [
		uuidv4(),
		object_detected.position.from_x,
		object_detected.position.from_y,
		object_detected.position.to_x,
		object_detected.position.to_y,
		object_detected.percentage,
		req.body.image_id];
		db.run('INSERT INTO tags(tag_title) VALUES(?);',[object_detected.tag_id],(err,row)=>{ 
			db.all("SELECT * FROM tags WHERE tag_title = ?;",[object_detected.tag_id],(err,row)=>{
                                 if(row.length>0){
                                        data.push(row[0].tag_id);
					console.log(data)
                                        db.run('INSERT INTO detection(detection_id,from_x,from_y,to_x,to_y,percentage,image_id,type,tag_id) VALUES(?,?,?,?,?,?,?,"object",?);',data,(err)=>{
                                                if(err)
                                                       console.log(err);
                                        })
                                }else{
                                        console.log("NOT WORKING AT ALL")
                                }
                        })
               })
	});
	db.run("UPDATE images SET treat = True WHERE image_id = ?;",[req.body.image_id],(err)=>{
		if(err){
			console.log(err);
		}
	})
})

app.get("/api/faces", checkSession, (req,res)=>{
	db.all('SELECT * FROM detection WHERE type = "face";',(err,rows)=>{
		if(err){
			console.log(err);
			res.status(500).json({});
		}else{
			res.json(rows);
		}
	})
})

app.get("/api/people", checkSession, (req, res) => {
    db.all('SELECT * FROM tags WHERE tag_title = "people";',(err,rows)=>{
        if(err) {
            console.log(err);
            res.status(500).json({})
        }else{
            res.json(rows)
        }
    })
})

app.use(function (req, res, next) {
    if (req.path.indexOf('.') === -1) {
        var file = process.env.HTML_DIR + req.path + '.html';
        console.log("["+new Date()+"]"+req.method+" "+file)
        fs.exists(file, function (exists) {
            if (exists)
                req.url += '.html';
            next();
        })
    } else {
        next();
    }
});

app.use("/", express.static(process.env.HTML_DIR));

function checkSession(req, res, next) {
    var session_token = req.cookies.session_token;
    db.all("SELECT * FROM session JOIN users ON session.user_id = users.user_id WHERE token = ?;", [session_token], (err, rows) => {
        if (rows.length > 0) {
            req.data = rows[0];
            next();
        } else {
            res.status(401).json({})
        }
    })
}

function makeFaceRecognition(user_id, image_id) {
    db.all('SELECT detection_id,tag_id FROM detection JOIN images ON detection.image_id = images.image_id WHERE images.user_id = ? AND detection.type = "face";', [user_id], (err, rows) => {
        if (err) {
            console.log(err);
        } else {
            var data = {
                image_id: image_id,
                user_id: user_id,
                faces_to_compare: rows
            };
            console.log("sending", data);
            request({
                uri: process.env.PYTHON_URL,
                method: "POST",
                json: data
            }, (error, response, body) => {
                if (error) {
                    console.log(error);
                } else if (response.statusCode == 200) {
                    console.log("process image", image_id);
                } else {
                    console.log("process image", image_id, "failed", response.statusCode, body);
                }
            })
        }
    })
}

app.listen(process.env.NODEJS_PORT)
