package com.example;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/hello")
public class GreetingResource {
    @GET
    public String hello() {
        return "hello";
    }
}
