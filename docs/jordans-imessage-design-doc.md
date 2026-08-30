# Onboard Users via iMessage

Our goal is let users onboard to Harvest using iMessage

## **Things to build**

1. The chef 
2. Inbound and outbound iMessage processing

## **iMessage Processing**

### **Inbound Messages**

1. User sends an inbound message to Spectrum
2. Spectrum sends an HTTP webhook message to Harvest server
3. Harvest server verifies the HMAC signature of the message
4. Harvest server persists the message in the database for processing after ensuring the user and thread exist, and  sends a doorbell to the inbound_messages queue with the idempotency key set to the thread id.  The unique index on message id ensures duplicate events are dropped.
5. The message consumer receives a doorbell of, loads the conversation history, the household, and it's users and invokes the chef 
6. The chef enters the response layer which invokes the reasoning layer via the process_message tool
7. The reasoning layer pulls the current objective of the agent, the conversation history, the household, and the users
8. The reasoning layer invokes tools to process the request and returns a response detailing what actions were taken to the response layer
9. The response layer decides how to respond to the user 

