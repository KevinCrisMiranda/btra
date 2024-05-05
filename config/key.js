require("dotenv").config()
module.exports = {
    database:{
        host:  process.env.DB,
        user:  process.env.USER,
        password: process.env.PASSWORD, 
        database:  process.env.DATABASE 
    }
}      