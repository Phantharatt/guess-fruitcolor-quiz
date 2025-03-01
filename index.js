import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from 'dotenv';
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

let quiz = [];
var user_login = "";

db.query("SELECT * FROM fruits",(err, res)=>{
  if(err){
    console.log("query Error !!!", err.stack);
  }else{
    quiz = res.rows;
  }
});

let totalCorrect = 0;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let currentQuestion = {};
// GET home page
app.get("/", async (req, res) => {
  totalCorrect = 0;
  await nextQuestion();
  // console.log(currentQuestion);
  res.render("index.ejs", { 
    question: currentQuestion,
    user: user_login
  });
});

// POST a new post
app.post("/submit", async(req, res) => {
  let answer = req.body.answer.trim();
  let isCorrect = false;
  if (currentQuestion.fruit_color.toLowerCase() === answer.toLowerCase()) {
    totalCorrect++;
    console.log("Total Score : ",totalCorrect);
    isCorrect = true;
    nextQuestion();
    res.render("index.ejs", {
      question: currentQuestion,
      wasCorrect: isCorrect,
      totalScore: totalCorrect,
      user : user_login
    });
  }
  else{
    if (user_login != ""){
      console.log(user_login,totalCorrect);
      await db.query("INSERT INTO scoreboard(username,score) VALUES ($1,$2);",[user_login,totalCorrect]);
    }
    res.render("gameover.ejs",{
      question: currentQuestion,
      totalScore: totalCorrect,
      user: user_login
    });
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
  const checkadmin = await db.query("SELECT * FROM admins WHERE username = $1 AND password = $2;",[username,password]);
  // console.log(result);
  if (checkadmin.rowCount !== 0){
    res.redirect("/admin");
  }
  else{
    const checkuser = await db.query("SELECT * FROM users WHERE username = $1 AND password = $2;",[username,password]);
    
    if (checkuser.rowCount !== 0){
      console.log("login Complete");
      user_login = username;
      res.redirect("/");
    }
    
    else{
      console.log("login fail")
      res.render("login.ejs",{
        error : "Wrong username or password"
      });
    }
  }
});

// Logout
app.get("/logout",(req,res)=>{
  user_login = "";
  res.redirect("/");
});

// Register Page 
app.get("/register",async(req,res)=>{
  res.render("register.ejs");
});

app.post("/register",async(req,res)=>{
  const username = req.body.username;
  const password = req.body.password;
  const confirm_password = req.body.confirm_password;
  console.log(username,password);
  if (password == confirm_password){
    try {
      await db.query("INSERT INTO users(username,password) VALUES ($1,$2);",[username,password]);
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

});

// Scoreboard

app.get("/scoreboard", async (req, res) => {
  try {
    const result = await db.query("SELECT username,score FROM scoreboard ORDER BY score DESC");
    const items = result.rows;
    console.log(items);
    res.render("scoreboard.ejs", {
      listItems: items,
      user: user_login
    });
  } catch (err) {
    console.log(err);
  }
});


// Admin Page
app.get("/admin",async(req,res)=>{
  res.render("admin/admin_menu.ejs");
})

app.get("/admin/add",async(req,res)=>{
  res.render("admin/admin_add.ejs");
})

app.get("/admin/edit",async(req,res)=>{
  res.render("admin/admin_edit.ejs");
})

app.get("/admin/remove",async(req,res)=>{
  res.render("admin/admin_remove.ejs");
})




async function nextQuestion() {
  const randomFruit = quiz[Math.floor(Math.random() * quiz.length)];

  currentQuestion = randomFruit;
  console.log(currentQuestion);
}

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
