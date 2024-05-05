const mysql = require('mysql');
const  { database } = require('./key');
const { promisify }=require('util');
const pool = mysql.createPool(database);

pool.getConnection((err,connection)=>{
    if(err){
        if(err.code==='PROTOCOL_CONNECTION_LOST'){
            console.log("perdida de conexion");
        }
        
        console.log(err);

    }
    if(connection) connection.release();
    console.log('Base de Datos Conectada');
    return;
});
pool.query = promisify(pool.query);
module.exports = pool;