import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from 'dotenv';
import { getFruitImages } from './pixabayAPI.js';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();
const port = process.env.PORT

const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

db.connect();

// for login Page 
var user_login = "";
let permission = false;

// for quiz
let quiz = [];
let totalCorrect = 0;

// bcrypt config
const saltRounds = 10;


db.query("SELECT * FROM fruits",(err, res)=>{
  if(err){
    console.log("query Error !!!", err.stack);
  }else{
    quiz = res.rows;
  }
});


// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let currentQuestion = {};


async function nextQuestion() {
  const randomFruit = quiz[Math.floor(Math.random() * quiz.length)];

  currentQuestion = randomFruit;
  console.log(currentQuestion);
}


// GET home page
app.get("/", async (req, res) => {
  totalCorrect = 0;
  await nextQuestion();
  // console.log(currentQuestion);
  res.render("index.ejs", { 
    question: currentQuestion,
    user: user_login,
    permission : permission
  });
});

// POST a new post
app.post("/submit", async(req, res) => {
  let answer = req.body.answer.trim();
  let isCorrect = false;
  const current_fruit = currentQuestion.fruit_name
  const current_color = currentQuestion.fruit_color
  if (current_color.toLowerCase() == answer.toLowerCase()) {
    totalCorrect++;
    console.log("Total Score : ",totalCorrect);
    isCorrect = true;
    nextQuestion();
    res.render("index.ejs", {
      question: currentQuestion,
      wasCorrect: isCorrect,
      totalScore: totalCorrect,
      user : user_login,
      permission : permission
    });
  }
  else{
    if (user_login != ""){
      // console.log(user_login,totalCorrect);
      await db.query("INSERT INTO scoreboard(username,score) VALUES ($1,$2);",[user_login,totalCorrect]);
    }
    try{
      const image = await getFruitImages(current_fruit, current_color);
      res.render("gameover.ejs",{
        question: currentQuestion,
        totalScore: totalCorrect,
        user: user_login,
        permission : permission,
        image: image
      });
    }
    catch(err){
      console.log("Can't GET fruit image",err);
      res.render("gameover.ejs", {
        question: currentQuestion,
        totalScore: totalCorrect,
        user: user_login,
        permission: permission,
        images: []
      });
    }
  }
});

// Login Page
app.get("/login",async(req,res)=>{
  res.render("login.ejs");
});

app.post("/login",async(req,res)=>{
  const username = req.body.username;
  const password = req.body.password;
  console.log(username,password);
  
  // Check admin login
  const checkadmin = await db.query("SELECT * FROM admins WHERE username = $1;", [username]);
  
  if (checkadmin.rowCount !== 0) {
    // Use bcrypt to compare password
    const match = await bcrypt.compare(password, checkadmin.rows[0].password);
    if (match) {
      console.log("Welcome Admin : ", username);
      user_login = username;
      permission = true;
      res.render("admin/admin_menu.ejs", {
        user : user_login
      });
    } else {
      res.render("login.ejs", {
        error : "Wrong username or password"
      });
    }
  } else {
    // Check user login
    const checkuser = await db.query("SELECT * FROM users WHERE username = $1;", [username]);
    
    if (checkuser.rowCount !== 0) {
      // Use bcrypt to compare password
      const match = await bcrypt.compare(password, checkuser.rows[0].password);
      if (match) {
        console.log("login Complete");
        user_login = username;
        res.redirect("/");
      } else {
        console.log("login fail")
        res.render("login.ejs", {
          error : "Wrong username or password"
        });
      }
    } else {
      console.log("login fail")
      res.render("login.ejs", {
        error : "Wrong username or password"
      });
    }
  }
});

// Logout
app.get("/logout",(req,res)=>{
  user_login = "";
  res.redirect("/");
  permission = false;
});

// Register Page 
app.get("/register",async(req,res)=>{
  res.render("register.ejs");
});

app.post("/register",async(req,res)=>{
  const username = req.body.username;
  const password = req.body.password;
  const confirm_password = req.body.confirm_password;
  const checkadmin = await db.query("SELECT * FROM admins WHERE LOWER(username) = LOWER($1)",[username]);
  console.log(username,password);
  if (checkadmin.rowCount == 0){
    if (password == confirm_password){
      try {
        // Hash password using bcrypt
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await db.query("INSERT INTO users(username,password) VALUES ($1,$2);", [username, hashedPassword]);
        res.redirect("/");
      }
      catch (err){
        res.render("register.ejs",{
          error : "Already have this username!!!"
        });
      }
    }
    else{
      res.render("register.ejs",{
        error : "Password does not match"
      });
    }
  }
  else{
    res.render("register.ejs",{
      error : "Already have this username!!!"
    });
  }
});

// Scoreboard Page
app.get("/scoreboard", async (req, res) => {
  try {
    const result = await db.query("SELECT username,score FROM scoreboard ORDER BY score DESC , id ASC");
    const items = result.rows;
    console.log(items);
    res.render("scoreboard.ejs", {
      listItems: items,
      user: user_login,
      permission : permission
    });
  } catch (err) {
    console.log(err);
  }
});


//check Permission
function checkPermission(res){
  if (!permission){
    res.redirect("/");
  }
}

// Admin Page
app.get("/admin",(req,res)=>{
  checkPermission(res);
  res.render("admin/admin_menu.ejs",{
    user : user_login
  });
});

// Admin Add Page
app.get("/admin/add",(req,res)=>{
  checkPermission(res);
  res.render("admin/admin_add.ejs");
});

app.post("/admin/add",async(req,res)=>{
  const fruit_name = req.body.fruit_name;
  const fruit_color = req.body.fruit_color;
  const check_name = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_name) = LOWER($1) ",[fruit_name]);
  const check_color = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_color) = LOWER($1) ",[fruit_color]);

    if (check_color.rowCount !== 0){
      if (check_name.rowCount == 0){
        await db.query("INSERT INTO fruits(fruit_name,fruit_color) VALUES ($1,$2);",[fruit_name,fruit_color]);
        res.render("admin/admin_add.ejs",{
          message : "Add Fruit in Database Success!!!",
          pass : true
        });
      }
      else{
        console.log("Name error!!!");
        res.render("admin/admin_add.ejs",{
          message : "Already have this Fruit Name in Database!!!"
        });
      }
    }
    else{
      console.log("Color error!!!");
      res.render("admin/admin_add.ejs",{
        message : "This color does not exist!!!"
      });
    }
});

let fruits = [];

async function getItems(){
  fruits = [];
  const result = await db.query("SELECT * FROM fruits ORDER BY id ASC");
  result.rows.forEach(data =>{
    fruits.push({name:data.fruit_name,color:data.fruit_color});
  });
}



// Admin Edit Page
app.get("/admin/edit",async(req,res)=>{
  checkPermission(res);
  await getItems();
  // console.log(items);
  checkPermission(res);
  res.render("admin/admin_edit.ejs",{
    fruits : fruits
  });
});

app.get("/admin/edit/:name",async(req,res)=>{
  checkPermission(res);
  const fruit_name = req.params.name;
  const result = await db.query("SELECT * FROM fruits WHERE fruit_name = $1;",[fruit_name]);
  console.log(result.rows[0]);
  res.render("admin/admin_edit_detail.ejs",{
    fruit_name : result.rows[0].fruit_name,
    fruit_color : result.rows[0].fruit_color
  });
});


// Admin Confirm Edit Page
app.post("/admin/edit/:name/update", async (req, res) => {
  checkPermission(res);
  const oldName = req.params.name;
  const newName = req.body.fruit_name;
  const newColor = req.body.fruit_color;
  
  const checkColor = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_color) = LOWER($1)", [newColor]);
  
  // Check Color doesn't has in database
  if (checkColor.rowCount === 0) {
    return res.render("admin/admin_edit_detail.ejs", {
      fruit_name: oldName,
      fruit_color: newColor,
      message: "This color does not exist!"
    });
  }
  
  // If fruit name changed, check if new name already exists
  if (oldName !== newName) {
    const checkName = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_name) = LOWER($1)", [newName]);
    if (checkName.rowCount > 0) {
      return res.render("admin/admin_edit_detail.ejs", {
        fruit_name: oldName,
        fruit_color: newColor,
        message: "This fruit name already exists in the database!"
      });
    }
  }
  
  await db.query(
    "UPDATE fruits SET fruit_name = $1, fruit_color = $2 WHERE fruit_name = $3",
    [newName, newColor, oldName]
  );

  res.redirect("/admin/edit");

});




// Admin Remove Page
app.get("/admin/remove",async(req,res)=>{
  checkPermission(res);
  await getItems();
  // console.log(items);
  checkPermission(res);
  res.render("admin/admin_remove.ejs",{
    fruits : fruits
  });
});

app.get("/admin/remove/:name/confirm",async(req,res)=>{
  checkPermission(res);
  const fruit_name = req.params.name;
  console.log(fruit_name);

  await db.query("DELETE FROM fruits WHERE fruit_name = $1;",[fruit_name]);
  res.redirect("/admin/remove");
});

// Get Fruit image from picalbayAPI.js
app.get("/fruit-images/:fruit", async (req, res) => {
  const fruit = req.params.fruit;
  const color = req.query.color;
  try {
    const images = await getFruitImages(fruit, color);
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fruit images' });
  }
});



app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});