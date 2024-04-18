// console.log("hello");
const express = require("express");
const PORT = 4000;
const app = express();

//register middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("./views"))  //cho phep dung tai nguyen tinh nhu css, javascript, images

//config view
app.set("view engine", "ejs"); //khai bap rang app se dung engine ejs de render trang web
app.set("views", "./views");      //Noi dung render trang web se nam trong thu muc ten views


app.listen(PORT, () => {
    console.log(`server dang ket noi den port ${PORT}`);
});


//Khai bao thu vien va cau hinh aws ket noi toi cloud thong qua accesskey vaf secretaccesskey
const multer = require("multer");    //Khai bao thu vien multer
const AWS = require("aws-sdk");     //Khai bao thu vien aws sdk
require("dotenv").config();     //Khai bao thu vien dotenv de doc bien moi truong
const path = require("path");

//Cau hinh AWS
process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = "1";

//Cau hinh aws sdk de truy cap vao cloud aws thong qua tai khoan IAM User
AWS.config.update({
    region: process.env.REGION,
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_ID,

});

const s3 = new AWS.S3();    //Khai bao service s3
const dynamodb = new AWS.DynamoDB.DocumentClient(); //Khai bao service dynamodb

const bucketName = process.env.S3_BUCKET_NAME;
const tableName = process.env.DYNAMODB_TABLE_NAME;

//Cau hinh multer quan ly upload image
const storage = multer.memoryStorage({
    destination(req, file, callback) {
        callback(null, "");
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2000000 },  //Chi cho phep file toi da la 2MB
    fileFilter(req, file, cb) {
        checkFileType(file, cb);
    },
});

function checkFileType(file, cb) {
    const fileTypes = /jepg|jpg|png|gif/;

    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileTypes.test(file.mimetype);
    if (extname && mimetype) {
        return cb(null, true);
    }
    return cb("vui long upload file anh jepg|jpg|png|gif");
}

//render date lên trang index.ejs tu mang dât lay tu cloud dynamodb
app.get("/", async (req, res) => {
    try {
        const params = { TableName: tableName };
        const data = await dynamodb.scan(params).promise(); //Dung ham scan de lay toan bo du lieu trong table dynamodb
        console.log("data=", data.Items);
        return res.render("index.ejs", { data: data.Items });     //Dung bien response de render trang index.ejs dong thoi truyen bien data
    } catch (error) {
        console.error("loi lay du lieu tu dynamoDB", error);
        return res.status(500).send("Internal Server Error");
    }
});

//luu data item len cloud dynamodb
app.post("/save", upload.single("image"), (req, res) => {
    //Middleware uploadsingle("image") chi dinh rang field co name "image" trong request se duoc xu ly
    try {
        const maSanPham = String(req.body.maSanPham);   //Lay ra cac tham so tu body cua form
        const tenSanPham = req.body.tenSanPham; //Lay ra cac tham so tu body cua form
        const soLuong = Number(req.body.soLuong);

        const image = req.file?.originalname.split(".");
        const fileType = image[image.length - 1];
        const filePath = `${maSanPham}_${Date.now().toString()}.${fileType}`;   //Dat ten cho hinh anh se luu trong s3  

        const paramsS3 = {
            Bucket: bucketName,
            Key: filePath,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        };

        s3.upload(paramsS3, async (err, data) => { //upload anh leen s3 truoc
            if (err) {
                console.error("error=", err);
                return res.send("Loi may chu noi bo!");

            } else { //Khi upload s3 thanh cong
                const imageURL = data.Location;     //Gan URL s3 tra ve vao field trong table DynamoDB
                const paramsDynamoDb = {
                    TableName: tableName,
                    Item: {
                        maSanPham: String(maSanPham),       //Bao gom thuoc tinh cua maSanPham voi gia tri cua no
                        tenSanPham: tenSanPham,
                        soLuong: soLuong,
                        image: imageURL,
                    },
                };
                await dynamodb.put(paramsDynamoDb).promise();
                return res.redirect("/");   //Render lai trang index de cap nhat du lieu table
            }
        });
    } catch (error) {
        console.error("Loi lay du lieu tu dynamodb: ", error);
        return res.status(500).send("internal server error");
    }
});

//Xoa item tren cloud DynamoDB
app.post("/delete", upload.fields([]), (req, res) => {
    const listCheckboxSelected = Object.keys(req.body);   //Lay ra ta ca checkboxes
    if (!listCheckboxSelected || listCheckboxSelected.length <= 0) {  //Neu khong co gi de xoa
        return res.redirect("/");
    }
    try {
        function onDeleteItem(length) {  //Dinh nghia ham de quy xoa
            const params = {
                TableName: tableName,
                Key: {
                    maSanPham: String(listCheckboxSelected[length]),
                },
            };

            dynamodb.delete(params, (err, data) => {  //Dung ham .delete cua aws-sdk
                if (err) {
                    console.error("error=", err);
                    return res.send("Loi may chu noi bo")
                } else if (length > 0) onDeleteItem(length - 1);    //Neu vi tri can xoa van >0 thi goi de quy tiep tuc xoa
                else return res.redirect("/");  //Render lai trang index.ejs de cap nhat du lieu table
            });
        }
        onDeleteItem(listCheckboxSelected.length - 1);    //Goi ham de quy xoa
    } catch (error) {
        console.error("Loi khong the xoa data tu DynamoDB", error);
        return res.status(500).send("Loi may chu noi bo");
    }
});